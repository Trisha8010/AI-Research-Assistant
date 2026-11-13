import os
import json
import faiss
import numpy as np
from typing import List, Dict, Any, Optional
# from sentence_transformers import SentenceTransformer (Moved to lazy load)
# from langchain_text_splitters import RecursiveCharacterTextSplitter (Moved to lazy load)
from google import genai
from google.genai import types
from datetime import datetime
from dotenv import load_dotenv
import fitz  # PyMuPDF
import PIL.Image
import docx
import re
import time
import threading

load_dotenv()

from key_manager import key_manager

class RAGEngine:
    def __init__(self):
        self._model = None
        self._text_splitter = None
        self.index = None
        self.chunks = []
        self.dimension = 384
        self.key_manager = key_manager
        self.available_models = []
        self.discovery_complete = False
        self._model_lock = threading.Lock()
        self._splitter_lock = threading.Lock()
        self.pre_warm()

    def pre_warm(self):
        """Load heavy models in a background thread to avoid blocking the first query."""
        import threading
        def warm():
            try:
                # Trigger lazy loads
                _ = self.model
                _ = self.text_splitter
                print("[RAG] Background pre-warm successful. Ready for instant queries! 🚀")
            except Exception as e:
                print(f"[RAG] Background pre-warm failed: {e}")
        
        thread = threading.Thread(target=warm, daemon=True)
        thread.start()

    @property
    def model(self):
        if self._model is None:
            with self._model_lock:
                if self._model is None:
                    from sentence_transformers import SentenceTransformer
                    self._model = SentenceTransformer('all-MiniLM-L6-v2')
        return self._model

    @property
    def text_splitter(self):
        if self._text_splitter is None:
            with self._splitter_lock:
                if self._text_splitter is None:
                    from langchain_text_splitters import RecursiveCharacterTextSplitter
                    self._text_splitter = RecursiveCharacterTextSplitter(
                        chunk_size=1000,
                        chunk_overlap=200,
                        length_function=len,
                    )
        return self._text_splitter

    def _discover_models(self):
        if self.discovery_complete:
            return
            
        if key_manager.client:
            try:
                # Add a primitive timeout check if possible, or just catch all
                # The GenAI library doesn't have an easy timeout for list_models yet
                for m in key_manager.client.models.list():
                    if 'generateContent' in m.supported_actions:
                        self.available_models.append(m.name)
                self.discovery_complete = True
            except Exception as e:
                self.available_models = ['models/gemini-2.0-flash', 'models/gemini-2.5-flash', 'models/gemini-flash-latest']
                self.discovery_complete = True # Don't keep retrying if it fails once

    def process_file(self, file_path: str, file_name: str, user_id: int):
        ext = file_name.split('.')[-1].lower()
        
        if ext == 'pdf':
            return self._process_pdf(file_path, file_name, user_id)
        elif ext in ['jpg', 'jpeg', 'png', 'webp', 'bmp']:
            return self._process_image(file_path, file_name, user_id)
        elif ext == 'docx':
            return self._process_docx(file_path, file_name, user_id)
        elif ext in ['txt', 'md', 'csv']:
            return self._process_text(file_path, file_name, user_id)
        else:
            print(f"Unsupported file type: {ext}")
            return 0, []

    def get_initial_suggestions(self, new_chunks: List[Dict[str, Any]]):
        if not new_chunks:
            return ["What are the key findings?", "Can you summarize the main points?", "What data is presented?"]
        
        # Take a small sample from the beginning of the document
        sample_text = "\n\n".join([c["text"] for c in new_chunks[:5]])
        prompt = f"Act as a research analyst. Based on this document snippet, suggest 3 high-impact things I can help the user with (e.g., analysis, summaries, data extraction). Output ONLY the 3 items, one per line, no numbering. Snippet: {sample_text}"
        
        priority = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-1.5-flash']
        try:
            response = self.key_manager.call_gemini_with_failover(
                "generate_content",
                priority,
                contents=prompt
            )
            questions = [q.strip() for q in response.text.split('\n') if q.strip()]
            return questions[:3]
        except Exception as e:
            print(f"Suggestion generation failed: {e}")
            return ["What are the key findings?", "Can you summarize the main points?", "What data is presented?"]

    def generate_session_title(self, question: str, answer: str):
        prompt = f"""
        Act as a professional archivist for a research suite.
        Based on this initial interaction, create a highly professional, academic, or business-oriented title for this research thread.
        
        RULES:
        - Maximum 6 words.
        - DO NOT just repeat the user's greeting.
        - Focus on the SUBJECT of the research or the NATURE of the request.
        - If the interaction is just a greeting, use 'General Research Inquiry'.
        - Output ONLY the title text.
        
        User: {question}
        AI: {answer[:300]}
        """
        priority = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-1.5-flash']
        try:
            response = self.key_manager.call_gemini_with_failover(
                "generate_content",
                priority,
                contents=prompt
            )
            title = response.text.strip().replace('"', '').replace('*', '')
            return title if title else "Research Inquiry"
        except Exception as e:
            print(f"Title generation failed: {e}")
            return "Research Inquiry"

    def _process_pdf(self, file_path: str, file_name: str, user_id: int):
        doc = fitz.open(file_path)
        new_chunks = []
        
        for page_num in range(len(doc)):
            if page_num % 10 == 0:
                print(f"Processing PDF page {page_num}/{len(doc)}...")
            page = doc.load_page(page_num)
            text = page.get_text()
            
            tables = None
            table_data = ""
            if text.strip():
                try:
                    tables = page.find_tables()
                    if tables:
                        for table in tables:
                            rows = table.extract()
                            table_str = "\n".join([" | ".join([str(cell) if cell else "" for cell in row]) for row in rows])
                            table_data += f"\n[Table Content]:\n{table_str}\n"
                except Exception as e:
                    print(f"Table extraction failed on page {page_num}: {e}")

            combined_text = text + table_data
            
            splits = self.text_splitter.split_text(combined_text)
            for split in splits:
                new_chunks.append({
                    "text": split,
                    "metadata": {
                        "source": file_name,
                        "page": page_num + 1,
                        "content_type": "text/pdf"
                    }
                })
        
        self.add_to_index(new_chunks, user_id=user_id)
        suggestions = self.get_initial_suggestions(new_chunks)
        return len(new_chunks), suggestions

    def _process_image(self, file_path: str, file_name: str, user_id: int):
        """Extract text from an image using Gemini Vision OCR."""
        try:
            uploaded_file = key_manager.call_gemini("upload_file", file=file_path)
            prompt = "Extract all readable text from this image accurately for research analysis. Format it cleanly. If there are tables, represent them as Markdown tables. Output ONLY the extracted text content."
            
            response = key_manager.call_gemini(
                "generate_content",
                model='models/gemini-2.0-flash-exp',
                contents=[
                    types.Part.from_text(text=prompt),
                    types.Part.from_uri(file_uri=uploaded_file.uri, mime_type=uploaded_file.mime_type)
                ]
            )
            extracted_text = response.text
            
            if not extracted_text.strip():
                return 0, []
                
            splits = self.text_splitter.split_text(extracted_text)
            new_chunks = []
            for split in splits:
                new_chunks.append({
                    "text": split,
                    "metadata": {
                        "source": file_name,
                        "page": 1,
                        "content_type": "image/ocr"
                    }
                })
                
            self.add_to_index(new_chunks, user_id=user_id)
            suggestions = self.get_initial_suggestions(new_chunks)
            return len(new_chunks), suggestions
        except Exception as e:
            print(f"Image OCR failed: {e}")
            return 0, []

    def _process_docx(self, file_path: str, file_name: str, user_id: int):
        try:
            doc = docx.Document(file_path)
            full_text = []
            for para in doc.paragraphs:
                full_text.append(para.text)
            
            text = "\n".join(full_text)
            splits = self.text_splitter.split_text(text)
            new_chunks = []
            for split in splits:
                new_chunks.append({
                    "text": split,
                    "metadata": {
                        "source": file_name,
                        "page": 1,
                        "content_type": "text/docx"
                    }
                })
            
            self.add_to_index(new_chunks, user_id=user_id)
            suggestions = self.get_initial_suggestions(new_chunks)
            return len(new_chunks), suggestions
        except Exception as e:
            print(f"Docx processing failed: {e}")
            return 0, []

    def _process_text(self, file_path: str, file_name: str, user_id: int):
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                text = f.read()
            
            splits = self.text_splitter.split_text(text)
            new_chunks = []
            for split in splits:
                new_chunks.append({
                    "text": split,
                    "metadata": {
                        "source": file_name,
                        "page": 1,
                        "content_type": "text/plain"
                    }
                })
            
            self.add_to_index(new_chunks, user_id=user_id)
            suggestions = self.get_initial_suggestions(new_chunks)
            return len(new_chunks), suggestions
        except Exception as e:
            print(f"Text processing failed: {e}")
            return 0, []

    def add_to_index(self, new_chunks: List[Dict[str, Any]], user_id: int):
        if not new_chunks:
            print("No chunks to add to index.")
            return
        
        try:
            texts = [c["text"] for c in new_chunks]
            
            # Batch process embeddings to avoid OOM or timeouts
            batch_size = 32
            all_embeddings = []
            
            print(f"[RAG] Encoding {len(texts)} chunks in batches of {batch_size}...")
            for i in range(0, len(texts), batch_size):
                batch_texts = texts[i:i + batch_size]
                batch_embeddings = self.model.encode(batch_texts)
                all_embeddings.append(batch_embeddings)
            
            embeddings = np.vstack(all_embeddings)
            x = np.array(embeddings).astype('float32')
            
            if len(x.shape) == 1:
                x = x.reshape(1, -1)
            
            num_vectors, vec_dim = x.shape
            
            if self.index is None:
                self.dimension = vec_dim
                self.index = faiss.IndexFlatL2(self.dimension)
            
            if vec_dim != self.dimension:
                print(f"[RAG] Dimension mismatch (Index: {self.dimension}, New: {vec_dim}). Rebuilding...")
                new_index = faiss.IndexFlatL2(vec_dim)
                self.index = new_index
                self.dimension = vec_dim

            self.index.add(x)
            
            for i, chunk in enumerate(new_chunks):
                chunk["user_id"] = user_id
                self.chunks.append(chunk)
            print(f"[RAG] Added {len(new_chunks)} chunks to index.")
        except Exception as e:
            print(f"CRITICAL ERROR in add_to_index: {str(e)}")
            import traceback
            traceback.print_exc()
            raise e

    def search(self, query: str, user_id: int, k: int = 15):
        if self.index is None:
            return []
            
    def delete_document(self, file_name: str, user_id: int):
        """Removes all chunks associated with a specific file for a user."""
        initial_count = len(self.chunks)
        self.chunks = [c for c in self.chunks if not (c.get("user_id") == user_id and c['metadata'].get('source') == file_name)]
        
        if len(self.chunks) != initial_count:
            print(f"Deleted {initial_count - len(self.chunks)} chunks for {file_name}")
            if self.chunks:
                # Rebuild FAISS index from remaining chunks
                texts = [c["text"] for c in self.chunks]
                embeddings = self.model.encode(texts)
                x = np.array(embeddings).astype('float32')
                
                # Use current dimension or detect from new embeddings
                dim = x.shape[1]
                self.index = faiss.IndexFlatL2(dim)
                self.index.add(x)
                self.dimension = dim
            else:
                self.index = None

    def search(self, query: str, user_id: int, k: int = 15):
        print(f"[RAG] Searching for '{query}' (User: {user_id}, Total Chunks in Memory: {len(self.chunks)})")
        if self.index is None or not self.chunks:
            print("[RAG] Warning: Search index is empty!")
            return []
            
        query_vector = self.model.encode([query])
        # Search for slightly more candidates than k to allow user_id filtering, but not 10x
        distances, indices = self.index.search(np.array(query_vector).astype('float32'), k * 3)
        
        results = []
        for i in range(indices.shape[1]):
            idx = indices[0][i]
            if idx != -1 and idx < len(self.chunks):
                chunk = self.chunks[idx]
                if chunk.get("user_id") == user_id:
                    results.append({
                        "chunk": chunk,
                        "score": float(1 / (1 + distances[0][i]))
                    })
            if len(results) >= k:
                break
        
        print(f"[RAG] Found {len(results)} relevant chunks.")
        return results

    def search_balanced(self, query: str, user_id: int, k: int = 20):
        """Ensures results are pulled from multiple documents if available."""
        if self.index is None:
            return []
            
        query_vector = self.model.encode([query])
        distances, indices = self.index.search(np.array(query_vector).astype('float32'), k * 10)
        
        results = []
        doc_counts = {}
        
        # First pass: try to get at least 3-4 chunks from each document
        for i in range(len(indices[0])):
            idx = indices[0][i]
            if idx != -1:
                chunk = self.chunks[idx]
                if chunk.get("user_id") == user_id:
                    doc_id = chunk['metadata'].get('source', 'unknown')
                    if doc_id not in doc_counts: doc_counts[doc_id] = 0
                    
                    # If comparing, prioritize diversity over raw score
                    if doc_counts[doc_id] < 5:
                        results.append({
                            "chunk": chunk,
                            "score": float(1 / (1 + distances[0][i]))
                        })
                        doc_counts[doc_id] += 1
            if len(results) >= k: break
            
        return results

    def refine_query(self, raw_query: str) -> str:
        prompt = f"""
        Fix typos and optimize this user query for a semantic vector search engine.
        Expand on abbreviations if obvious. Only output the corrected search keywords, nothing else.
        Query: {raw_query}
        """
        try:
            priority = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-flash-latest']
            response = self.key_manager.call_gemini_with_failover(
                "generate_content",
                priority,
                contents=prompt
            )
            refined = response.text.strip().replace('"', '')
            return refined if refined else raw_query
        except Exception as e:
            print(f"Query refinement failed: {e}")
            return raw_query

    def query(self, query: str, mode: str = "general", history: Optional[str] = None, use_web: bool = False, user_id: Optional[int] = None, model_preference: Optional[str] = None, user_name: Optional[str] = None):
        greetings = [
            "hi", "hello", "hey", "howdy", "greetings", "yo", "hey there", "hi there", 
            "how are you", "how are you doing", "what's up", "sup", "good morning", 
            "good afternoon", "good evening", "how r u", "how r you", "how are u",
            "hru", "wbu", "hbu"
        ]
        acknowledgements = ["ok", "okay", "good", "nice", "thanks", "thank you", "got it", "i see", "cool", "fine", "great", "awesome", "perfect", "thx"]
        identity_questions = ["who are you", "what are you", "what is your name", "who am i talking to", "what can you do"]
        
        clean_query = query.lower().strip().replace("?", "").replace("!", "").replace(".", "")
        
        # 1. Handle Greetings (Instant)
        if clean_query in greetings or any(g == clean_query for g in greetings) or (len(query.split()) <= 3 and any(g in clean_query for g in greetings)):
             return {
                "answer": f"Hello {user_name if user_name else ''}! 👋 I'm your Research Intelligence Assistant. How can I help you with your data or documents today? 😊",
                "citations": [],
                "confidence": 100.0
            }
            
        # 2. Handle Identity Questions (Instant)
        if any(q in clean_query for q in identity_questions):
            return {
                "answer": "I am your AI Research Assistant, powered by the Research Intelligence Suite. I can analyze documents, search the web, and help you synthesize complex information! 🚀",
                "citations": [],
                "confidence": 100.0
            }

        # 3. Handle short acknowledgements (Instant)
        if clean_query in acknowledgements or (len(query.split()) < 3 and any(a in clean_query for a in acknowledgements)):
            return {
                "answer": f"You're welcome! Let me know if you have any other research tasks for me. 🚀",
                "citations": [],
                "confidence": 100.0
            }

        # Determine if we should use balanced search for comparison
        is_comparison = any(kw in query.lower() for kw in ["compare", "difference", "both", "all docs", "versus", "vs"])

        # Optimize query for vector search (autocorrect typos)
        search_query = self.refine_query(query)
        print(f"[RAG] Refined query from '{query}' to '{search_query}'")

        # Search directly with the refined query
        if is_comparison:
            context_results = self.search_balanced(search_query, user_id=user_id)
        else:
            context_results = self.search(search_query, user_id=user_id)

        context_text = "\n\n".join([f"Source: {r['chunk']['metadata']['source']} (Page {r['chunk']['metadata']['page']})\nContent: {r['chunk']['text']}" for r in context_results])
        
        is_empty_context = not context_text.strip()
        
        contents = []
        if history:
            try:
                history_json = json.loads(history)
                for m in history_json:
                    # Map 'assistant' role to 'model' for Gemini SDK
                    role = 'model' if m['role'].lower() == 'assistant' else 'user'
                    contents.append({'role': role, 'parts': [{'text': m['content']}]})
            except Exception as e:
                print(f"[RAG] Error parsing history: {e}")

        # Dynamic Mode Instructions
        if use_web:
            mode_instructions = "GLOBAL RESEARCH MODE: You have access to Google Search. Synthesize web results with any provided context. Be friendly but very concise! ✨"
        else:
            mode_instructions = "LOCAL RESEARCH MODE (STRICT RAG): Use ONLY the provided CONTEXT. Be friendly, brief, and do not use outside knowledge. 📚"

        kg_structure = '{"nodes": [{"id": "Name", "type": "concept/person/tech"}], "links": [{"source": "A", "target": "B", "label": "relates to"}]}'
        research_prompt = """
        You are ResearchAI, a brilliant and friendly AI Research Assistant. ✨
        TONE: Friendly, helpful, and enthusiastic! Use emojis. 💡
        CONCISENESS: CRITICAL - Only provide information that was explicitly asked for. Do NOT provide unsolicited deep-dives or breakdowns unless requested. If the user gives feedback or a short acknowledgement, respond with a brief, friendly acknowledgement and wait for the next instruction. 🚀
        MODE: {mode_text}
        CONTEXT: {context_text}
        USER'S MESSAGE: {query_text}
        USER'S NAME: {user_name_val}
        
        EXTREMELY IMPORTANT:
        1. If the user asks who they are, who is using the application, or for their name, refer to them by the NAME provided in USER'S NAME. Be friendly and personalized! 😊
        2. If you are explaining a process, relationship, or data that would benefit from a visual representation, use Mermaid.js syntax inside 'mermaid' code blocks.
        3. STRICTNESS POLICY:
           If MODE is 'LOCAL RESEARCH MODE', you MUST NOT use any knowledge outside of the provided CONTEXT. If the answer is not present in the context, say: "I couldn't find this information in your research library. Try enabling **Web Search**! ✨"
        4. SUGGESTIONS: At the very end of your response (but before the <kg_data> block), provide 2-3 brief, relevant ways you can help the user next. Instead of just questions, phrase them proactively, like "I can also help you with..." or "Would you like me to analyze...". Prefix the ENTIRE block once with "I can also help with: " or "You might also want to explore: " followed by the bullet points. Do NOT use "Try asking: " repeatedly. ✨
        5. KNOWLEDGE GRAPH EXTRACTION:
           Always extract the top 5-8 key entities and their relationships from the context provided.
           Format this as a JSON object inside a single <kg_data> block at the very end of your response.
           Structure: {kg_structure}
        
        DESIGN GUIDELINES:
        - Use professional Mermaid syntax (graph TD, graph LR, etc.).
        - Use 'subgraph' to group related items for clarity.
        - IMPORTANT: Subgraph names MUST NOT be the same as node names.
        - IMPORTANT: Avoid cycles where a node or subgraph tries to contain itself.
        - CRITICAL MERMAID RULE: If a node label contains ANY parentheses, brackets, or dots, you MUST wrap the label in double quotes. 
          INCORRECT: A[Python (Flask)]
          CORRECT: A["Python (Flask)"]
        - Add descriptive labels to edges.
        - Keep the logic structured and aesthetically balanced.
        
        TABLE GUIDELINES:
        - If comparing two or more items, ALWAYS use a professional Markdown Table.
        - Use clear headers and concise cell content.
        - Ensure tables have proper newlines before and after them.
        
        Example:
        ```mermaid
        graph TD
          subgraph Data Source
            A["PDF Files (Local)"] --> B["Text Extraction"]
          end
          B --> C["Vector Embedding"]
          C --> D["FAISS Index"]
        ```
        Keep diagrams clear, modern, and high-impact. ✨📊
        """.replace("{mode_text}", mode_instructions) \
           .replace("{context_text}", context_text if not is_empty_context else "None") \
           .replace("{query_text}", query) \
           .replace("{kg_structure}", kg_structure) \
           .replace("{user_name_val}", user_name if user_name else "Guest Research Associate")
        
        if key_manager.client:
            response_text = None
            priority_order = [
                'gemini-2.0-flash',
                'gemini-2.5-flash',
                'gemini-3-flash-preview',
                'gemini-flash-latest',
                'gemini-1.5-flash'
            ]
            
            if model_preference:
                pref = model_preference.replace('models/', '')
                if pref in priority_order:
                    priority_order.remove(pref)
                priority_order.insert(0, pref)
            
            # Append current prompt to the history contents
            final_contents = contents + [{'role': 'user', 'parts': [{'text': research_prompt}]}]
            
            for model_name in priority_order:
                try:
                    config = {"tools": [{"google_search": {}}]} if use_web else {}
                    response = key_manager.call_gemini(
                        "generate_content",
                        model=model_name,
                        contents=final_contents,
                        config=config
                    )
                    response_text = response.text
                    break
                except Exception as e:
                    err_msg = str(e).upper()
                    print(f"Model {model_name} failed: {e}")
                    # If web search failed due to quota, try one more time WITHOUT web search
                    if use_web and ("QUOTA" in err_msg or "429" in err_msg or "LIMIT" in err_msg):
                        print(f"Retrying {model_name} WITHOUT web search...")
                        try:
                            response = key_manager.call_gemini(
                                "generate_content",
                                model=model_name,
                                contents=final_contents,
                                config={}
                            )
                            response_text = response.text
                            break
                        except Exception:
                            continue
                    continue
            
            # If after all attempts response_text is still None, return a graceful, actionable error
            if response_text is None:
                status = key_manager.status()
                cooling = status.get("cooling_keys") or []
                msg = (
                    "Unable to generate a response — all available API keys failed or hit quota limits. "
                    f"Configured keys: {status.get('total_configured', 0)}, "
                    f"valid: {status.get('valid', 0)}, "
                    f"currently cooling: {cooling or 'none'}. "
                    "Add more keys via GOOGLE_API_KEYS (comma-separated) or wait a few minutes for cooldowns to expire."
                )
                return {
                    "answer": msg,
                    "error": "api_keys_exhausted",
                    "citations": [],
                    "confidence": 0,
                    "kg_data": {"nodes": [], "links": []},
                    "diagnostics": status,
                }

            # Extract Knowledge Graph data if present
            kg_data = {"nodes": [], "links": []}
            clean_answer = response_text if response_text else ""
            if "<kg_data>" in response_text:
                try:
                    parts = response_text.split("<kg_data>")
                    clean_answer = parts[0].strip()
                    kg_json_str = parts[1].split("</kg_data>")[0].strip()
                    kg_data = json.loads(kg_json_str)
                except Exception as e:
                    print(f"KG Parsing error: {e}")

            return {
                "answer": clean_answer or "Error processing response.",
                "citations": [{**r['chunk']['metadata'], "text": r['chunk']['text']} for r in context_results],
                "confidence": self._calculate_confidence(context_results),
                "kg_data": kg_data
            }
        else:
            return {
                "error": "api_keys_missing",
                "answer": "No valid API keys are configured. Set GOOGLE_API_KEY or GOOGLE_API_KEYS (comma-separated) in your .env file and restart the server.",
                "citations": [],
                "confidence": 0,
                "kg_data": {"nodes": [], "links": []},
            }

    def _calculate_confidence(self, results):
        if not results: return 0
        avg_score = sum([r['score'] for r in results]) / len(results)
        return round(avg_score * 100, 2)

    def extract_knowledge_graph(self):
        if not self.chunks:
            return {"nodes": [], "edges": []}
            
        sample_context = "\n\n".join([c["text"] for c in self.chunks[:10]])
        kg_example = '{"nodes": [{"id": "Entity Name", "type": "Person/Tech/Concept", "source": "Filename.pdf"}], "edges": [{"source": "Entity A", "target": "Entity B", "label": "relationship description"}]}'
        prompt = """
            Analyze the following research text and extract a Knowledge Graph.
            The graph should contain Entities (nodes) and Relationships (edges).
            
            EXTREMELY IMPORTANT:
            For EVERY node, you must identify which "Source File" it came from.
            
            Text:
            {sample_context_text}
            
            Return ONLY a valid JSON object with this exact structure:
            {kg_example_text}
            """.replace("{sample_context_text}", sample_context) \
               .replace("{kg_example_text}", kg_example)
        
        priority_order = [
            'models/gemini-2.0-flash', 
            'models/gemini-2.5-flash', 
            'models/gemini-3-flash-preview',
            'models/gemini-flash-latest'
        ]
        
        for model_name in priority_order:
            try:
                response = key_manager.call_gemini(
                    "generate_content",
                    model=model_name,
                    contents=prompt
                )
                json_match = re.search(r'\{.*\}', response.text, re.DOTALL)
                if json_match:
                    return json.loads(json_match.group())
                break
            except Exception as e:
                print(f"[KG] Model {model_name} failed: {e}")
                continue
                
        return {"nodes": [], "edges": []}


rag_engine = RAGEngine()
