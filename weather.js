(() => {
        function getLunarDay(date) {
            const baseDate = new Date(2026, 0, 19); 
            const diffDays = Math.floor((date - baseDate) / (1000 * 60 * 60 * 24));
            let lunarDay = (diffDays % 29.53) + 1;
            if (lunarDay < 1) lunarDay += 29.53;
            return Math.floor(lunarDay % 30) || 30;
        }

        class WeatherBackgroundEngine {
            constructor() {
                if (window.__weatherEngineInstance) return window.__weatherEngineInstance;
                window.__weatherEngineInstance = this;

                this.canvas = document.getElementById('dynamicBgCanvas');
                this.ctx = this.canvas.getContext('2d');
                this.celestialContainer = document.getElementById('celestialObjects');
                this.lightningOverlay = document.getElementById('lightningOverlay');
                this.snowDriftEl = document.getElementById('snowDriftGround');
                
                this.particles = [];
                this.clouds = [];
                this.comets = [];
                this.splashes = [];
                this.snowAccumulationHeight = 0;
                this.weatherMode = 'auto';
                this.themeMode = 'auto';
                this.rainIntensity = 0.5;
                this.intensityTimer = 0;
                this.celestialEl = null;
                this.animationFrameId = null;
                this.isRunning = false;

                this.apiWeatherCode = 0; 
                this.apiIsDay = null; 
                
                this.initSize();
                window.addEventListener('resize', () => this.initSize());

                this.initElements();
                this.startLoop();
            }

            initSize() {
                if (!this.canvas) return;
                this.width = window.innerWidth;
                this.height = window.innerHeight;
                this.canvas.width = this.width;
                this.canvas.height = this.height;
            }

            async fetchLocalWeather() {
                try {
                    let lat = 25.04, lon = 121.56;
                    if (navigator.geolocation) {
                        navigator.geolocation.getCurrentPosition(pos => {
                            lat = pos.coords.latitude;
                            lon = pos.coords.longitude;
                            this.queryOpenMeteo(lat, lon);
                        }, () => this.queryOpenMeteo(lat, lon), { timeout: 4000 });
                    } else {
                        this.queryOpenMeteo(lat, lon);
                    }
                } catch (e) {}
            }

            async queryOpenMeteo(lat, lon) {
                try {
                    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code,is_day&timezone=auto`, {signal:AbortSignal.timeout(8000)});
                    const data = await res.json();
                    if (data && data.current) {
                        this.apiWeatherCode = data.current.weather_code;
                        this.apiIsDay = data.current.is_day === 1;
                        if (this.weatherMode === 'auto') {
                            this.initElements();
                        }
                    }
                } catch (e) {}
            }

            getCurrentScenario() {
                // 如果手動指定了 8 大情境之一
                if (this.weatherMode !== 'auto') {
                    const parts = this.weatherMode.split('_');
                    return {
                        type: parts[0],
                        isNight: parts[1] === 'night'
                    };
                }

                // 如果外觀模式手動指定了白天或黑夜
                let isNight = false;
                if (this.themeMode === 'dark') isNight = true;
                else if (this.themeMode === 'light') isNight = false;
                else {
                    if (this.apiIsDay !== null) {
                        isNight = !this.apiIsDay;
                    } else {
                        const hour = new Date().getHours();
                        const month = new Date().getMonth() + 1;
                        const sunsetHour = (month >= 5 && month <= 8) ? 19 : (month >= 11 || month <= 2) ? 17.5 : 18;
                        isNight = hour >= sunsetHour || hour < 6;
                    }
                }

                let type = 'sunny';
                if (this.apiWeatherCode >= 95) type = 'storm';
                else if (this.apiWeatherCode >= 71 && this.apiWeatherCode <= 77) type = 'snow';
                else if (this.apiWeatherCode >= 51 && this.apiWeatherCode <= 67) type = 'drizzle';
                else type = 'sunny';

                return { type, isNight };
            }

            setWeatherMode(mode) { this.weatherMode = mode; this.initElements(); }
            setThemeMode(mode) { this.themeMode = mode; if (this.weatherMode === 'auto') this.initElements(); }
            stopLoop() { this.isRunning=false; cancelAnimationFrame(this.animationFrameId); }
            initElements() {
                this.particles = [];
                this.clouds = [];
                this.comets = [];
                this.splashes = [];
                this.snowAccumulationHeight = 0;
                if (this.snowDriftEl) this.snowDriftEl.style.height = '0px';
                if (this.celestialContainer) this.celestialContainer.innerHTML = '';
                if (this.lightningOverlay) this.lightningOverlay.className = 'lightning-overlay';
                
                const scenario = this.getCurrentScenario();
                const isNight = scenario.isNight;
                const type = scenario.type;

                const statusText = document.getElementById('weatherStatusText');
                const iconInd = document.getElementById('weatherIconIndicator');

                if (type === 'sunny') {
                    if (isNight) {
                        const starCount = Math.floor(this.width * 0.08);
                        for (let i = 0; i < starCount; i++) {
                            this.particles.push({
                                x: Math.random() * this.width,
                                y: Math.random() * (this.height * 0.7),
                                radius: Math.random() * 1.5 + 0.5,
                                alpha: Math.random(),
                                deltaAlpha: (Math.random() * 0.02 + 0.005) * (Math.random() < 0.5 ? 1 : -1)
                            });
                        }

                        const lunarDay = getLunarDay(new Date());
                        let moonShadowStyle = 'inset_-12px_-4px_0px_0px_#fde047'; 
                        let phaseName = `農曆初${lunarDay} 滿月`;
                        if (lunarDay <= 3 || lunarDay >= 28) {
                            moonShadowStyle = 'inset_-3px_-1px_0px_0px_#fde047'; phaseName = `農曆初${lunarDay} 蛾眉月`;
                        } else if (lunarDay > 3 && lunarDay <= 9) {
                            moonShadowStyle = 'inset_-8px_-2px_0px_0px_#fde047'; phaseName = `農曆初${lunarDay} 上弦月`;
                        } else if (lunarDay > 9 && lunarDay <= 19) {
                            moonShadowStyle = 'inset_-1px_-1px_0px_0px_#fde047'; phaseName = `農曆十五 滿月`;
                        } else if (lunarDay > 19 && lunarDay <= 23) {
                            moonShadowStyle = 'inset_8px_2px_0px_0px_#fde047'; phaseName = `農曆廿二 下弦月`;
                        } else {
                            moonShadowStyle = 'inset_4px_1px_0px_0px_#fde047'; phaseName = `農曆廿七 殘月`;
                        }

                        this.celestialEl = document.createElement('div');
                        this.celestialEl.className = `absolute w-16 h-16 rounded-full shadow-[${moonShadowStyle}] opacity-95 pointer-events-none transition-transform duration-1000`;
                        if (this.celestialContainer) this.celestialContainer.appendChild(this.celestialEl);

                        for (let i = 0; i < 2; i++) {
                            this.comets.push({
                                x: Math.random() * this.width * 1.2,
                                y: Math.random() * (this.height * 0.35),
                                length: Math.random() * 120 + 150,
                                speed: 0.8 + Math.random() * 0.6,
                                angle: Math.PI / 6 + Math.random() * 0.1,
                                alpha: 0,
                                maxAlpha: 0.75 + Math.random() * 0.2,
                                progress: 0,
                                lifeSpan: 400 + Math.random() * 200,
                                nextTrigger: Math.random() * 300 + i * 200
                            });
                        }

                        if (statusText) statusText.textContent = `動態天象：黑夜星空 (${phaseName}與彗星)`;
                        if (iconInd) iconInd.className = 'fa-solid fa-moon text-indigo-300';
                    } else {
                        for (let i = 0; i < 4; i++) {
                            this.clouds.push({
                                x: Math.random() * this.width,
                                y: Math.random() * (this.height * 0.4),
                                size: Math.random() * 60 + 80,
                                speed: Math.random() * 0.2 + 0.1
                            });
                        }
                        this.celestialEl = document.createElement('div');
                        this.celestialEl.className = 'absolute flex items-center justify-center pointer-events-none transition-transform duration-1000';
                        this.celestialEl.innerHTML = `
                            <div class="relative flex items-center justify-center">
                                <div class="absolute w-56 h-56 rounded-full bg-amber-300/30 enhanced-sun-flare blur-2xl"></div>
                                <div class="absolute w-16 h-16 rounded-full bg-gradient-to-br from-amber-200 via-amber-400 to-orange-500 shadow-[0_0_50px_rgba(251,191,36,0.9)]"></div>
                            </div>
                        `;
                        if (this.celestialContainer) this.celestialContainer.appendChild(this.celestialEl);
                        if (statusText) statusText.textContent = '動態天象：白天晴朗耀光';
                        if (iconInd) iconInd.className = 'fa-solid fa-sun text-amber-500';
                    }
                } else if (type === 'drizzle') {
                    const count = Math.floor(this.width * 0.15);
                    for (let i = 0; i < count; i++) {
                        this.particles.push({
                            x: Math.random() * this.width,
                            y: Math.random() * this.height,
                            length: Math.random() * 14 + 8,
                            speed: Math.random() * 4 + 5,
                            opacity: Math.random() * 0.4 + 0.2
                        });
                    }
                    if (statusText) statusText.textContent = isNight ? '動態天象：黑夜毛毛雨 (含水花)' : '動態天象：白天毛毛雨 (含水花)';
                    if (iconInd) iconInd.className = isNight ? 'fa-solid fa-cloud-moon text-blue-300' : 'fa-solid fa-cloud-rain text-blue-400';
                } else if (type === 'storm') {
                    const count = Math.floor(this.width * 0.3);
                    for (let i = 0; i < count; i++) {
                        this.particles.push({
                            x: Math.random() * this.width,
                            y: Math.random() * this.height,
                            length: Math.random() * 26 + 15,
                            speed: Math.random() * 14 + 18,
                            opacity: Math.random() * 0.5 + 0.3
                        });
                    }
                    if (statusText) statusText.textContent = isNight ? '動態天象：黑夜雷雨交織' : '動態天象：白天雷雨交織';
                    if (iconInd) iconInd.className = isNight ? 'fa-solid fa-bolt text-indigo-400' : 'fa-solid fa-cloud-bolt text-blue-500';
                } else if (type === 'snow') {
                    const count = Math.floor(this.width * 0.22);
                    for (let i = 0; i < count; i++) {
                        this.particles.push({
                            x: Math.random() * this.width,
                            y: Math.random() * this.height,
                            radius: Math.random() * 3 + 1.5,
                            speed: Math.random() * 1.5 + 1,
                            drift: Math.random() * 1 - 0.5,
                            opacity: Math.random() * 0.6 + 0.3
                        });
                    }
                    if (statusText) statusText.textContent = isNight ? '動態天象：黑夜下雪 (含漸進積雪)' : '動態天象：白天下雪 (含漸進積雪)';
                    if (iconInd) iconInd.className = isNight ? 'fa-solid fa-snowflake text-indigo-200' : 'fa-solid fa-snowflake text-sky-300';
                }
            }

            startLoop() {
                if (this.isRunning) return;
                this.isRunning = true;

                let previousFrame = 0;
                const loop = () => {
                    const now = performance.now();
                    if (now - previousFrame < 33) { if (this.isRunning) this.animationFrameId = requestAnimationFrame(loop); return; }
                    previousFrame = now;
                    if (!this.ctx || !this.isRunning) return;
                    this.ctx.clearRect(0, 0, this.width, this.height);
                    const scenario = this.getCurrentScenario();
                    const isNight = scenario.isNight;
                    const type = scenario.type;

                    if (this.snowDriftEl) {
                        if (type === 'snow') {
                            if (this.snowAccumulationHeight < 24) {
                                this.snowAccumulationHeight += 0.04;
                            }
                            this.snowDriftEl.style.height = `${this.snowAccumulationHeight}px`;
                        } else {
                            this.snowAccumulationHeight = 0;
                            this.snowDriftEl.style.height = '0px';
                        }
                    }

                    if (this.celestialEl && type === 'sunny' && !isNight) {
                        const now = new Date();
                        const hours = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
                        let progress = Math.max(0, Math.min(1, (hours - 6) / 12));
                        const x = progress * this.width;
                        const y = 240 - 80 * Math.sin(progress * Math.PI);
                        this.celestialEl.style.left = `${x}px`;
                        this.celestialEl.style.top = `${y}px`;
                    }

                    if (type === 'drizzle' || type === 'storm') {
                        this.intensityTimer += 0.03;
                        this.rainIntensity = type === 'storm' ? (0.5 + Math.abs(Math.sin(this.intensityTimer)) * 0.5) : 0.3; 

                        if (type === 'storm' && Math.random() < 0.035 && this.lightningOverlay) {
                            this.lightningOverlay.classList.add('lightning-active');
                            setTimeout(() => { if (this.lightningOverlay) this.lightningOverlay.classList.remove('lightning-active'); }, 400);
                        }

                        const activeCount = Math.floor(this.particles.length * (type === 'storm' ? (this.rainIntensity + 0.2) : 1.0));
                        const windAngleX = type === 'storm' ? -2.5 : -0.5;

                        this.ctx.strokeStyle = isNight ? 'rgba(147, 197, 253, 0.85)' : 'rgba(110, 165, 210, 0.9)';
                        this.ctx.lineWidth = type === 'storm' ? 1.3 : 0.9;
                        this.ctx.beginPath();
                        
                        for (let i = 0; i < activeCount && i < this.particles.length; i++) {
                            let pt = this.particles[i];
                            this.ctx.moveTo(pt.x, pt.y);
                            this.ctx.lineTo(pt.x + windAngleX, pt.y + pt.length);
                            
                            pt.y += pt.speed * (type === 'storm' ? (1.0 + this.rainIntensity * 0.4) : 1.0);
                            pt.x += windAngleX;

                            if (pt.y > this.height - 70 || pt.x < 0) {
                                const splashChance = type === 'storm' ? 0.35 : 0.2;
                                if (Math.random() < splashChance) {
                                    this.splashes.push({
                                        x: pt.x, y: this.height - Math.random() * 70 - 10,
                                        r: 1, maxR: type === 'storm' ? (Math.random() * 15 + 8) : (Math.random() * 8 + 4), alpha: 0.7
                                    });
                                }
                                pt.y = -20;
                                pt.x = Math.random() * (this.width + 200);
                            }
                        }
                        this.ctx.stroke();

                        this.ctx.lineWidth = type === 'storm' ? 1.0 : 0.7;
                        for (let sp of this.splashes) {
                            this.ctx.strokeStyle = isNight ? `rgba(147, 197, 253, ${sp.alpha})` : `rgba(90, 140, 190, ${sp.alpha})`;
                            this.ctx.beginPath();
                            this.ctx.ellipse(sp.x, sp.y, sp.r, sp.r * 0.38, 0, 0, Math.PI * 2);
                            this.ctx.stroke();
                            sp.r += type === 'storm' ? 0.75 : 0.45;
                            sp.alpha -= type === 'storm' ? 0.045 : 0.035;
                        }
                        this.splashes = this.splashes.filter(sp => sp.alpha > 0);

                    } else if (type === 'snow') {
                        this.ctx.fillStyle = isNight ? 'rgba(226, 232, 240, 0.85)' : 'rgba(255, 255, 255, 0.95)';
                        this.ctx.beginPath();
                        for (let s of this.particles) {
                            this.ctx.moveTo(s.x, s.y);
                            this.ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
                            s.y += s.speed;
                            s.x += Math.sin(s.y * 0.02) * 0.5 + s.drift;

                            if (s.y > this.height) {
                                s.y = -10;
                                s.x = Math.random() * this.width;
                            }
                        }
                        this.ctx.fill();

                    } else if (type === 'sunny' && isNight) {
                        for (let s of this.particles) {
                            s.alpha += s.deltaAlpha;
                            if (s.alpha > 1 || s.alpha < 0.2) s.deltaAlpha *= -1;
                            this.ctx.fillStyle = `rgba(255, 255, 255, ${s.alpha})`;
                            this.ctx.beginPath();
                            this.ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
                            this.ctx.fill();
                        }

                        for (let c of this.comets) {
                            c.nextTrigger--;
                            if (c.nextTrigger <= 0 && c.progress >= c.lifeSpan) {
                                c.x = Math.random() * (this.width + 200) - 100;
                                c.y = Math.random() * (this.height * 0.25);
                                c.progress = 0;
                                c.lifeSpan = 450 + Math.random() * 250;
                                c.nextTrigger = Math.random() * 400 + 200;
                            }

                            if (c.progress < c.lifeSpan) {
                                c.progress++;
                                c.x -= Math.cos(c.angle) * c.speed;
                                c.y += Math.sin(c.angle) * c.speed;

                                let fadeInOutAlpha = c.maxAlpha;
                                if (c.progress < 80) fadeInOutAlpha = (c.progress / 80) * c.maxAlpha;
                                else if (c.progress > c.lifeSpan - 100) fadeInOutAlpha = ((c.lifeSpan - c.progress) / 100) * c.maxAlpha;

                                if (fadeInOutAlpha > 0) {
                                    this.ctx.save();
                                    const tailX = c.x + Math.cos(c.angle) * c.length;
                                    const tailY = c.y - Math.sin(c.angle) * c.length;
                                    const gradient = this.ctx.createLinearGradient(c.x, c.y, tailX, tailY);
                                    gradient.addColorStop(0, `rgba(230, 245, 255, ${fadeInOutAlpha})`);
                                    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
                                    this.ctx.strokeStyle = gradient;
                                    this.ctx.lineWidth = 2.2;
                                    this.ctx.beginPath();
                                    this.ctx.moveTo(c.x, c.y);
                                    this.ctx.lineTo(tailX, tailY);
                                    this.ctx.stroke();
                                    this.ctx.restore();
                                }
                            }
                        }
                    } else if (type === 'sunny' && !isNight) {
                        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
                        for (let c of this.clouds) {
                            this.ctx.beginPath();
                            this.ctx.arc(c.x, c.y, c.size, 0, Math.PI * 2);
                            this.ctx.arc(c.x + c.size * 0.6, c.y - c.size * 0.2, c.size * 0.7, 0, Math.PI * 2);
                            this.ctx.fill();
                            c.x += c.speed;
                            if (c.x - c.size > this.width) c.x = -c.size * 2;
                        }
                    }

                    this.animationFrameId = requestAnimationFrame(loop);
                };
                loop();
            }
        }


(() => {
 const modes=['off','auto','sunny_day','sunny_night','drizzle_day','drizzle_night','storm_day','storm_night','snow_day','snow_night'];
 let engine=null;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const resume=()=>{ if(!engine)return;engine.stopLoop();if(app.weatherMode!=='off'&&!document.hidden&&!reduced.matches)engine.startLoop(); };
 app.setWeatherMode=mode=>{
  if(!modes.includes(mode))return;
  app.weatherMode=mode;
  if(mode!=='off'){app.themeMode=mode==='auto'?'auto':mode.endsWith('_night')?'dark':'light';app.saveSettings();}
  try{localStorage.setItem('shiguang_weather_mode',mode);}catch(error){}
  const layer=document.getElementById('weatherLayer');layer.hidden=mode==='off';
  document.getElementById('weatherScene').value=mode;
  if(mode==='off'){engine?.stopLoop();document.getElementById('weatherStatusText').textContent='動態天象已關閉';return;}
  if(!engine){engine=new WeatherBackgroundEngine();
    const initElements=engine.initElements.bind(engine);
    engine.initElements=()=>{initElements();if(app.weatherMode!=='off'&&app.themeMode==='auto')document.documentElement.classList.toggle('dark',engine.getCurrentScenario().isNight);};
  }
  engine.setThemeMode(app.themeMode);engine.setWeatherMode(mode);app.applyTheme();app.updateSettingsUI();resume();
 };
 app.fetchWeatherLocation=()=>{app.setWeatherMode('auto');engine.fetchLocalWeather();document.getElementById('weatherLocationHint').textContent='定位失敗時採臺北天氣；天氣服務不可用時採本機時間與晴天情境。';};
 const applyTheme=app.applyTheme.bind(app);
 app.applyTheme=()=>{
  applyTheme();
  if(engine && app.weatherMode!=='off'){
   if(engine.themeMode!==app.themeMode)engine.setThemeMode(app.themeMode);
   document.documentElement.classList.toggle('dark',engine.getCurrentScenario().isNight);
  }
 };
 const setThemeMode=app.setThemeMode.bind(app);
 app.setThemeMode=mode=>{
  setThemeMode(mode);
  if(app.weatherMode!=='off'){
   const base=app.weatherMode==='auto'?'sunny':app.weatherMode.split('_')[0];
   app.setWeatherMode(mode==='auto'?'auto':base+(mode==='dark'?'_night':'_day'));
  }
 };
 document.addEventListener('visibilitychange',resume);reduced.addEventListener('change',resume);
 let mode='off';try{mode=localStorage.getItem('shiguang_weather_mode')||'off';}catch(error){}
 app.setWeatherMode(modes.includes(mode)?mode:'off');
})();

})();
