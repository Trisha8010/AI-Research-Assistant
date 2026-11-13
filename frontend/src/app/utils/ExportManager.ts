
export const downloadMarkdown = (title: string, messages: any[]) => {
  let content = `# Research Report: ${title}\n\n`;
  content += `Generated on: ${new Date().toLocaleString()}\n\n---\n\n`;

  messages.forEach((msg, index) => {
    const role = msg.role === 'user' ? 'Researcher' : 'Assistant';
    content += `### ${role}\n${msg.content}\n\n`;

    if (msg.citations && msg.citations.length > 0) {
      content += `#### Sources:\n`;
      msg.citations.forEach((c: any, i: number) => {
        content += `- [${i + 1}] ${c.filename} (Confidence: ${msg.confidence || 'N/A'}%)\n`;
      });
      content += `\n`;
    }
    
    content += `---\n\n`;
  });

  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_report.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const downloadSessionJSON = (title: string, messages: any[]) => {
  const data = {
    title,
    exported_at: new Date().toISOString(),
    messages
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_session.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
