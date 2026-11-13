
export class VoiceAssistant {
  private static synth: SpeechSynthesis | null = typeof window !== 'undefined' ? window.speechSynthesis : null;
  private static utterance: SpeechSynthesisUtterance | null = null;

  static speak(text: string, onEnd?: () => void) {
    if (!this.synth) return;

    // Stop any current speech
    this.synth.cancel();

    // Clean text of markdown and emoji for better speech
    const cleanText = text
      .replace(/[#*_`]/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F200}-\u{1F2FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu, '');

    this.utterance = new SpeechSynthesisUtterance(cleanText);
    
    // Select a premium sounding voice if available
    const voices = this.synth.getVoices();
    const premiumVoice = voices.find(v => 
      v.name.includes('Google US English') || 
      v.name.includes('Samantha') || 
      v.name.includes('Natural')
    );
    
    if (premiumVoice) this.utterance.voice = premiumVoice;
    
    this.utterance.rate = 1.0;
    this.utterance.pitch = 1.0;
    this.utterance.volume = 1.0;

    if (onEnd) this.utterance.onend = onEnd;

    this.synth.speak(this.utterance);
  }

  static stop() {
    if (this.synth) this.synth.cancel();
  }

  static pause() {
    if (this.synth) this.synth.pause();
  }

  static resume() {
    if (this.synth) this.synth.resume();
  }
  
  static isSpeaking() {
    return this.synth?.speaking || false;
  }
}
