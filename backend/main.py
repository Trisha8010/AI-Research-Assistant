from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, status, Body
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from jose import JWTError, jwt
from passlib.context import CryptContext
from datetime import datetime, timedelta
import shutil
import os
import json
import uuid
from typing import List, Optional
from rag_engine import rag_engine
from models import User, Document, Message, SessionLocal, init_db

app = FastAPI(title="AI Research Assistant API")

# Initialize DB
init_db()

# Security Config
SECRET_KEY = os.getenv("SECRET_KEY", "change-this-to-a-secure-random-key-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 # 1 week

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

import threading

def background_indexing():
    print("[Startup] Syncing library with RAG engine...")
    db = SessionLocal()
    try:
        docs = db.query(Document).all()
        for doc in docs:
            if os.path.exists(doc.file_path):
                print(f"[Startup] Indexing: {doc.filename}")
                rag_engine.process_file(doc.file_path, doc.filename, user_id=doc.user_id)
        print(f"[Startup] Sync complete. {len(docs)} documents indexed.")
    except Exception as e:
        print(f"[Startup] Error during indexing: {e}")
    finally:
        db.close()

@app.on_event("startup")
def startup_event():
    threading.Thread(target=background_indexing, daemon=True).start()
    # Start periodic validation of API keys (every 6 hours by default)
    rag_engine.key_manager.start_periodic_validation()
    print("[Startup] Periodic key validation scheduled.")


# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
CONV_DIR = "conversions"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(CONV_DIR, exist_ok=True)

app.mount("/conversions", StaticFiles(directory=CONV_DIR), name="conversions")

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

security = HTTPBearer()

async def get_current_user(auth: HTTPAuthorizationCredentials = Depends(security), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        token = auth.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise credentials_exception
    return user

@app.post("/register")
async def register(email: str = Form(...), password: str = Form(...), username: str = Form(...), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == email).first()
    if user:
        raise HTTPException(status_code=400, detail="Email already registered")
    hashed_password = pwd_context.hash(password)
    new_user = User(email=email, username=username, hashed_password=hashed_password)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"status": "success", "user_id": new_user.id}

@app.post("/token")
async def login(email: str = Form(...), password: str = Form(...), username: Optional[str] = Form(None), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == email).first()
    if not user or not pwd_context.verify(password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    
    if username:
        user.username = username
        db.commit()
        db.refresh(user)

    access_token = create_access_token(data={"sub": user.email})
    
    # Reset API key quota tracking for the new login session
    rag_engine.key_manager.reset_exhaustion()
    
    return {"access_token": access_token, "token_type": "bearer", "user": {"id": user.id, "email": user.email, "username": user.username}}

@app.post("/upload")
def upload_file(
    file: UploadFile = File(...), 
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        file_path = os.path.join(UPLOAD_DIR, f"{user.id}_{file.filename}")
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Track in DB
        new_doc = Document(filename=file.filename, file_path=file_path, user_id=user.id)
        db.add(new_doc)
        db.commit()

        print(f"[Backend] Starting RAG processing for: {file.filename}")
        num_chunks, suggestions = rag_engine.process_file(file_path, file.filename, user_id=user.id)
        print(f"[Backend] Processing complete: {num_chunks} chunks.")
        
        return {
            "filename": file.filename, 
            "id": new_doc.id, 
            "chunks": num_chunks, 
            "suggestions": suggestions,
            "status": "processed"
        }
    except Exception as e:
        print(f"[Backend] Upload Error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Internal Processing Error: {str(e)}")

@app.post("/query")
def query_assistant(
    question: str = Form(...), 
    mode: str = Form("general"),
    history: Optional[str] = Form(None),
    web_search: bool = Form(False),
    model: Optional[str] = Form(None),
    session_id: Optional[str] = Form(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Use existing session or create a new one
    from models import ChatSession
    
    if not session_id:
        session_id = str(uuid.uuid4())
        # Create a new session entry
        title = question[:50] + ("..." if len(question) > 50 else "")
        session = ChatSession(id=session_id, title=title, user_id=user.id)
        db.add(session)
        db.flush() # Ensure session exists before messages
    else:
        # Verify session exists
        session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
        if not session:
            # If session ID provided but not in DB (e.g. from deleted DB), create it
            title = question[:50] + ("..." if len(question) > 50 else "")
            session = ChatSession(id=session_id, title=title, user_id=user.id)
            db.add(session)
            db.flush()

    # Save User Message
    user_msg = Message(role="user", content=question, user_id=user.id, session_id=session_id)
    db.add(user_msg)
    
    response = rag_engine.query(question, user_id=user.id, mode=mode, history=history, use_web=web_search, model_preference=model, user_name=user.username)
    
    # Save AI Message
    import json
    citations_json = json.dumps(response.get("citations", []))
    extra_json = json.dumps({"kg_data": response.get("kg_data", {})})
    ai_msg = Message(
        role="assistant", 
        content=response["answer"], 
        citations=citations_json, 
        extra_data=extra_json,
        user_id=user.id, 
        session_id=session_id
    )
    db.add(ai_msg)
    
    # Auto-generate a descriptive title if it's currently a generic snippet or too short
    is_generic = session.title == question[:50] + ("..." if len(question) > 50 else "")
    if is_generic or len(session.title or "") < 10 or session.title.lower() in ["hey", "hi", "hello"]:
        print(f"[TitleGen] Generating professional title for session {session_id}...")
        new_title = rag_engine.generate_session_title(question, response["answer"])
        if new_title and len(new_title) > 3:
            session.title = new_title
            print(f"[TitleGen] New title: {new_title}")
        
    db.commit()
    db.refresh(user_msg)
    db.refresh(ai_msg)
    
    response["session_id"] = session_id
    response["user_message_id"] = user_msg.id
    response["assistant_message_id"] = ai_msg.id
    return response

@app.get("/history")
async def get_history(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        from models import ChatSession
        sessions = db.query(ChatSession).filter(ChatSession.user_id == user.id).order_by(ChatSession.created_at.desc()).all()
        
        return {"history": [
            {"session_id": s.id, "title": s.title, "timestamp": s.created_at} 
            for s in sessions
        ]}
    except Exception as e:
        print(f"History fetch error: {e}")
        return {"history": []}

@app.get("/history/{session_id}")
async def get_session_history(session_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        messages = db.query(Message).filter(
            Message.session_id == session_id, 
            Message.user_id == user.id
        ).order_by(Message.created_at.asc()).all()
        
        import json
        return {"messages": [
            {
                "id": m.id,
                "role": m.role, 
                "content": m.content, 
                "citations": json.loads(m.citations) if m.citations else []
            } for m in messages
        ]}
    except Exception as e:
        print(f"Session history fetch error: {e}")
        return {"messages": []}

@app.get("/documents")
async def get_documents(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        docs = db.query(Document).filter(Document.user_id == user.id).all()
        return {"documents": [{"id": d.id, "filename": d.filename} for d in docs]}
    except Exception as e:
        print(f"Docs fetch error: {e}")
        return {"documents": []}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.get("/diagnostics")
def diagnostics():
    """Return key-health snapshot so operators can see exhaustion/quota state."""
    km = rag_engine.key_manager
    return km.status()

@app.delete("/documents/{doc_id}")
async def delete_document(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    doc = db.query(Document).filter(Document.id == doc_id, Document.user_id == user.id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Remove from RAG engine
    rag_engine.delete_document(doc.filename, user.id)
    
    # Remove from disk
    if os.path.exists(doc.file_path):
        try:
            os.remove(doc.file_path)
        except Exception as e:
            print(f"Failed to delete file from disk: {e}")
    
    db.delete(doc)
    db.commit()
    return {"status": "success", "filename": doc.filename}

@app.delete("/history/{session_id}")
async def delete_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from models import ChatSession
    session = db.query(ChatSession).filter(ChatSession.id == session_id, ChatSession.user_id == user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    db.delete(session)
    db.commit()
    return {"status": "success"}

@app.delete("/messages/{message_id}")
async def delete_message(
    message_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    msg = db.query(Message).filter(Message.id == message_id, Message.user_id == user.id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    
    db.delete(msg)
    db.commit()
    return {"status": "success"}

@app.put("/messages/{message_id}")
async def edit_message(
    message_id: int,
    content: str = Body(..., embed=True),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    msg = db.query(Message).filter(Message.id == message_id, Message.user_id == user.id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    
    msg.content = content
    db.commit()
    return {"status": "success", "content": content}

@app.post("/clear")
def clear_index(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Remove from memory index
    rag_engine.chunks = [c for c in rag_engine.chunks if c.get("user_id") != user.id]
    # In a real app, we'd rebuild the FAISS index or use a partitioned one
    # For now, we clear the DB docs
    db.query(Document).filter(Document.user_id == user.id).delete()
    db.query(Message).filter(Message.user_id == user.id).delete()
    db.commit()
    return {"status": "user data cleared"}

@app.get("/knowledge-graph")
def get_knowledge_graph(user: User = Depends(get_current_user)):
    return rag_engine.extract_knowledge_graph()

@app.delete("/messages/{message_id}/subsequent")
async def delete_subsequent_messages(
    message_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    msg = db.query(Message).filter(Message.id == message_id, Message.user_id == user.id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    
    # Delete all messages in the same session created after this one
    subsequent = db.query(Message).filter(
        Message.session_id == msg.session_id,
        Message.created_at > msg.created_at
    ).all()
    
    for m in subsequent:
        db.delete(m)
    
    db.commit()
    return {"status": "success", "count": len(subsequent)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
