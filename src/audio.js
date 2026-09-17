export class AudioEngine {
  constructor() { this.enabled = true; this.volume = .65; this.active = false; }
  async start() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();this.master.gain.value=this.enabled?this.volume*.42:0;
      this.compressor=this.ctx.createDynamicsCompressor();this.compressor.threshold.value=-14;this.compressor.ratio.value=5;
      this.master.connect(this.compressor);this.compressor.connect(this.ctx.destination);
      this.noiseBuffer=this.ctx.createBuffer(1,this.ctx.sampleRate*2,this.ctx.sampleRate);
      const data=this.noiseBuffer.getChannelData(0);let last=0;
      for(let i=0;i<data.length;i++){last=(last+(Math.random()*2-1)*.13)/1.13;data[i]=last*3.5;}
      this.rotor=this.ctx.createBufferSource();this.rotor.buffer=this.noiseBuffer;this.rotor.loop=true;
      const filter=this.ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=310;
      this.rotorGain=this.ctx.createGain();this.rotorGain.gain.value=.15;
      this.rotor.connect(filter);filter.connect(this.rotorGain);this.rotorGain.connect(this.master);this.rotor.start();
      this.pulse=this.ctx.createOscillator();this.pulse.type='sine';this.pulse.frequency.value=19;
      const pulseGain=this.ctx.createGain();pulseGain.gain.value=.09;this.pulse.connect(pulseGain);pulseGain.connect(this.rotorGain.gain);this.pulse.start();
      this.engine=this.ctx.createOscillator();this.engine.type='sawtooth';this.engine.frequency.value=58;
      const engineFilter=this.ctx.createBiquadFilter();engineFilter.type='lowpass';engineFilter.frequency.value=190;
      this.engineGain=this.ctx.createGain();this.engineGain.gain.value=.045;
      this.engine.connect(engineFilter);engineFilter.connect(this.engineGain);this.engineGain.connect(this.master);this.engine.start();
    }
    if(this.ctx.state==='suspended')await this.ctx.resume();this.active=true;
  }
  setEnabled(enabled) {this.enabled=enabled;this.setVolume(this.volume);if(enabled)this.start().catch(()=>{});}
  setVolume(volume) {this.volume=volume;if(this.master)this.master.gain.setTargetAtTime(this.enabled?volume*.42:0,this.ctx.currentTime,.07);}
  tone(frequency,duration=.15,gain=.2,type='sine',end=null,delay=0) {
    if(!this.ctx||!this.enabled)return;
    const at=this.ctx.currentTime+delay,o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type=type;o.frequency.setValueAtTime(frequency,at);
    if(end)o.frequency.exponentialRampToValueAtTime(Math.max(20,end),at+duration);
    g.gain.setValueAtTime(gain,at);g.gain.exponentialRampToValueAtTime(.001,at+duration);
    o.connect(g);g.connect(this.master);o.start(at);o.stop(at+duration+.03);
  }
  noise(duration,gain,freq=900) {
    if(!this.ctx||!this.enabled)return;
    const at=this.ctx.currentTime,s=this.ctx.createBufferSource(),g=this.ctx.createGain(),f=this.ctx.createBiquadFilter();
    s.buffer=this.noiseBuffer;f.type='lowpass';f.frequency.value=freq;g.gain.setValueAtTime(gain,at);g.gain.exponentialRampToValueAtTime(.001,at+duration);
    s.connect(f);f.connect(g);g.connect(this.master);s.start(at);s.stop(at+duration+.03);
  }
  event(e) {
    if(!this.ctx||!this.enabled)return;
    if(e.type==='shot') {
      if(e.weapon===0){this.noise(.09,.7,1500);this.tone(145,.07,.23,'triangle',45);}
      else{this.noise(.4,.7,1400);this.tone(e.weapon===1?130:190,.23,.22,'sawtooth',35);}
    }
    if(e.type==='explosion'){this.noise(.8,.95*e.size,650);this.tone(73,.55,.6,'sine',24);}
    if(e.type==='playerHit'){this.noise(.14,.65,900);this.tone(110,.12,.4,'triangle',50);}
    if(e.type==='radio'){this.tone(930,.06,.07,'sine');this.tone(1250,.1,.05,'sine',null,.08);}
    if(e.type==='incoming'){this.tone(640,.13,.15,'square');this.tone(850,.13,.1,'square',null,.2);}
    if(e.type==='flares'){this.noise(.5,.5,2400);this.tone(1300,.22,.09,'sine',300);}
    if(e.type==='rescue'||e.type==='objective') {for(let i=0;i<3;i++)this.tone([440,550,660][i],.28,.14,'triangle',null,i*.1);}
    if(e.type==='end') {for(let i=0;i<4;i++)this.tone(e.success?[262,330,392,524][i]:[260,230,195,130][i],.7,.18,'triangle',null,i*.22);}
  }
  update(speed,phase) {
    if(!this.ctx)return;
    const playing=phase==='playing';
    this.rotorGain.gain.setTargetAtTime(playing?.19+speed*.002:.025,this.ctx.currentTime,.1);
    this.engineGain.gain.setTargetAtTime(playing?.05:.01,this.ctx.currentTime,.1);
    this.pulse.frequency.setTargetAtTime(playing?19+speed*.07:13,this.ctx.currentTime,.1);
    this.engine.frequency.setTargetAtTime(playing?58+speed*.4:47,this.ctx.currentTime,.1);
  }
}
