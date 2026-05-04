// 配置常量
const CONFIG = {
    MAX_TRANSCRIPT_LINES: 50,
    DURATION_UPDATE_INTERVAL: 100,
    NORMAL_SPEED_MIN: 100,
    NORMAL_SPEED_MAX: 160,
    SPEED_WARNING_MIN: 80,
    SPEED_WARNING_MAX: 180,
    FILLER_PATTERN: /(嗯|呃|就是|然后|啊|那个|这个|那个那个|就是说|这样的话)/g,
    FILLER_COLORS: {
        '嗯': '#4b7bec',
        '呃': '#f59e0b',
        '就是': '#10b981',
        '然后': '#ef4444',
        '啊': '#8e9db1',
        '那个': '#9b59b6',
        '这个': '#e67e22',
        '那个那个': '#1abc9c',
        '就是说': '#e84342',
        '这样的话': '#3498db'
    }
};

// 初始状态
const INITIAL_STATS = {
    wordCount: 0,
    fillerCount: 0,
    startTime: null,
    pauseTime: null,
    totalPausedDuration: 0,
    speedHistory: [],
    totalSpeedSamples: 0,
    averageSpeed: 0,
    fillerBreakdown: {
        '嗯': 0, '呃': 0, '就是': 0, '然后': 0, '啊': 0,
        '那个': 0, '这个': 0, '那个那个': 0, '就是说': 0, '这样的话': 0
    }
};

class SpeechCoach {
    constructor() {
        this.state = {
            isListening: false,
            isPaused: false,
            finalTranscript: '',
            interimTranscript: '',
            transcriptLines: [],
            stats: { ...INITIAL_STATS },
            isDarkMode: false,
            chartsReady: false
        };

        this.dom = {};
        this.charts = { speed: null, filler: null };
        this.animationFrameId = null;
        this.recognition = null;
        
        this.updateDurationDisplay = this.updateDurationDisplay.bind(this);
        
        this.init();
    }

    init() {
        this.cacheDOMElements();
        this.initSpeechRecognition();
        this.initChartsAsync();  // 异步初始化图表
        this.bindEvents();
        this.initTheme();
        this.updateAllDisplays();
    }

    async initChartsAsync() {
        // 等待 ECharts 加载完成后再初始化图表
        if (typeof whenEChartsReady !== 'undefined') {
            whenEChartsReady((echarts) => {
                this.initSpeedChart(echarts);
                this.initFillerChart(echarts);
                this.state.chartsReady = true;
                window.addEventListener('resize', this.handleChartResize.bind(this));
            });
        } else {
            // 降级方案：如果 whenEChartsReady 不存在，直接尝试加载
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js';
            script.onload = () => {
                this.initSpeedChart(window.echarts);
                this.initFillerChart(window.echarts);
                this.state.chartsReady = true;
                window.addEventListener('resize', this.handleChartResize.bind(this));
            };
            document.body.appendChild(script);
        }
    }

    cacheDOMElements() {
        const ids = [
            'start-btn', 'pause-btn', 'theme-btn', 'transcript-box',
            'placeholder-text', 'speed-value', 'avg-speed-value',
            'filler-count', 'filler-breakdown', 'duration-value',
            'status-dot', 'status-text', 'interim-indicator', 'suggestions'
        ];
        
        ids.forEach(id => {
            this.dom[id] = document.getElementById(id);
        });
        
        this.dom.speedProgress = document.querySelector('#speed-progress .progress-fill');
    }

    initTheme() {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        this.state.isDarkMode = prefersDark;
        if (prefersDark) {
            document.body.classList.add('dark-mode');
        }
    }

    toggleTheme = () => {
        this.state.isDarkMode = !this.state.isDarkMode;
        document.body.classList.toggle('dark-mode', this.state.isDarkMode);
        this.updateCharts();
    }

    initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            this.showError('您的浏览器不支持语音识别，请使用 Chrome 或 Edge');
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'zh-CN';
        this.recognition.maxAlternatives = 1;

        this.recognition.onresult = this.handleRecognitionResult.bind(this);
        this.recognition.onerror = this.handleRecognitionError.bind(this);
        this.recognition.onend = this.handleRecognitionEnd.bind(this);
    }

    handleRecognitionResult(event) {
        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                final += transcript;
                this.addTranscriptLine(transcript, true);
            } else {
                interim += transcript;
            }
        }

        if (final) {
            this.state.finalTranscript += final;
            this.updateStats(final);
            this.updateSpeedDisplay();
        }
        
        this.state.interimTranscript = interim;
        this.updateTranscriptDisplay();
    }

    handleRecognitionError(event) {
        if (event.error === 'no-speech') return;
        
        this.updateStatus('error', `错误: ${event.error}`);
        if (event.error === 'not-allowed') {
            this.showSuggestion('请允许麦克风权限以使用语音识别');
        }
    }

    handleRecognitionEnd() {
        if (this.state.isListening && !this.state.isPaused) {
            try {
                this.recognition.start();
            } catch (error) {
                setTimeout(() => {
                    if (this.state.isListening && !this.state.isPaused) {
                        try {
                            this.recognition.start();
                        } catch (e) {}
                    }
                }, 1000);
            }
        } else {
            this.updateStatus('idle', '已停止');
        }
    }

    initSpeedChart(echarts) {
        const chartDom = document.getElementById('speed-chart');
        if (!chartDom) return;

        this.charts.speed = echarts.init(chartDom);
        this.charts.speed.setOption({
            grid: { top: 20, left: 35, right: 15, bottom: 20, containLabel: true },
            tooltip: { trigger: 'axis', formatter: '第 {b} 秒<br/>语速: {c} 字/分钟' },
            xAxis: {
                type: 'category',
                data: [],
                axisLabel: { fontSize: 10, color: this.getChartTextColor() }
            },
            yAxis: {
                type: 'value',
                min: 0,
                max: 200,
                splitLine: { lineStyle: { color: this.getChartLineColor(), type: 'dashed' } },
                axisLabel: { fontSize: 10, color: this.getChartTextColor() }
            },
            series: [{
                data: [],
                type: 'line',
                smooth: true,
                lineStyle: { color: '#4b7bec', width: 2 },
                areaStyle: { color: 'rgba(75, 123, 236, 0.05)' },
                symbol: 'circle',
                symbolSize: 6,
                markPoint: {
                    data: [
                        { type: 'max', name: '峰值', symbolSize: 30 },
                        { type: 'min', name: '谷值', symbolSize: 30 }
                    ],
                    symbol: 'pin',
                    symbolSize: 40
                },
                markLine: {
                    data: [
                        { name: '理想语速下限', yAxis: 100, lineStyle: { color: '#10b981', type: 'dashed', width: 1 } },
                        { name: '理想语速上限', yAxis: 160, lineStyle: { color: '#10b981', type: 'dashed', width: 1 } }
                    ],
                    symbol: 'none',
                    label: { show: false }
                }
            }]
        });
    }

    initFillerChart(echarts) {
        const chartDom = document.getElementById('filler-chart');
        if (!chartDom) return;

        this.charts.filler = echarts.init(chartDom);
        this.charts.filler.setOption({
            tooltip: { trigger: 'item', formatter: '{b}: {c}次 ({d}%)' },
            legend: { show: false },
            series: [{
                type: 'pie',
                radius: ['50%', '70%'],
                avoidLabelOverlap: false,
                label: { show: false },
                emphasis: { scale: true },
                data: Object.entries(CONFIG.FILLER_COLORS).map(([name, color]) => ({
                    value: 0, name, itemStyle: { color }
                }))
            }]
        });
    }

    getChartTextColor() {
        return this.state.isDarkMode ? '#a0a0a0' : '#8e9db1';
    }

    getChartLineColor() {
        return this.state.isDarkMode ? '#333333' : '#edf0f5';
    }

    handleChartResize() {
        if (!this.state.chartsReady) return;
        requestAnimationFrame(() => {
            if (this.charts.speed) this.charts.speed.resize();
            if (this.charts.filler) this.charts.filler.resize();
        });
    }

    bindEvents() {
        this.dom['start-btn'].addEventListener('click', this.toggleStart.bind(this));
        this.dom['pause-btn'].addEventListener('click', this.togglePause.bind(this));
        this.dom['theme-btn'].addEventListener('click', this.toggleTheme);
    }

    toggleStart() {
        if (this.state.isListening) {
            this.stop();
        } else {
            this.clear();
            this.start();
        }
    }

    start() {
        if (!this.recognition) return;

        try {
            setTimeout(() => {
                try {
                    this.recognition.start();
                } catch (error) {
                    this.showSuggestion('启动失败，请重试', 'warning');
                    return;
                }
                
                this.state.isListening = true;
                this.state.isPaused = false;
                this.state.stats.startTime = this.state.stats.startTime || Date.now();
                
                this.startDurationAnimation();
                this.updateStatus('active', '聆听中...');
                this.updateButtons();
                this.updateInterimIndicator('正在聆听...');
                this.updateButtonHTML('start-btn', 'stop');
                this.showSuggestion('✅ 开始练习，请自然表达', 'success');
            }, 100);
        } catch (error) {
            console.error('启动失败:', error);
        }
    }

    stop() {
        try {
            this.recognition?.stop();
        } catch (error) {}

        this.stopDurationAnimation();
        this.state.isListening = false;
        this.state.isPaused = false;
        
        this.updateButtons();
        this.updateStatus('idle', '已停止');
        this.updateInterimIndicator('已停止');
        this.updateButtonHTML('start-btn', 'start');
        this.updateDurationDisplay();
    }

    togglePause() {
        if (!this.state.isListening) return;

        if (this.state.isPaused) {
            try {
                this.recognition.start();
                this.state.isPaused = false;
                this.updateStatus('active', '聆听中...');
                
                if (this.state.stats.pauseTime) {
                    this.state.stats.totalPausedDuration += Date.now() - this.state.stats.pauseTime;
                    this.state.stats.pauseTime = null;
                }
                
                this.startDurationAnimation();
                this.updateButtons();
                this.updatePauseButtonIcon('resume');
                this.showSuggestion('▶️ 继续练习', 'neutral');
            } catch (error) {
                this.showSuggestion('恢复失败，请重试', 'warning');
            }
        } else {
            try {
                this.recognition.stop();
                this.state.isPaused = true;
                this.state.stats.pauseTime = Date.now();
                this.updateStatus('paused', '已暂停');
                this.state.interimTranscript = '';
                this.updateTranscriptDisplay();
                
                this.stopDurationAnimation();
                this.updateDurationDisplay();
                this.updateButtons();
                this.updatePauseButtonIcon('pause');
                this.showSuggestion('⏸️ 已暂停，点击继续', 'neutral');
            } catch (error) {}
        }
        
        this.updateInterimIndicator(this.state.isPaused ? '已暂停' : '正在聆听...');
    }

    updatePauseButtonIcon(state) {
        const btn = this.dom['pause-btn'];
        if (state === 'pause') {
            btn.innerHTML = `
                <svg class="icon" viewBox="0 0 24 24" width="20" height="20">
                    <polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>
                </svg>
                继续
            `;
        } else {
            btn.innerHTML = `
                <svg class="icon" viewBox="0 0 24 24" width="20" height="20">
                    <rect x="7" y="6" width="3" height="12" fill="currentColor"/>
                    <rect x="14" y="6" width="3" height="12" fill="currentColor"/>
                </svg>
                暂停
            `;
        }
    }

    startDurationAnimation() {
        this.stopDurationAnimation();
        
        let lastUpdate = 0;
        const animate = (timestamp) => {
            if (!this.state.isListening || this.state.isPaused) return;
            
            if (timestamp - lastUpdate >= CONFIG.DURATION_UPDATE_INTERVAL) {
                this.updateDurationDisplay();
                lastUpdate = timestamp;
            }
            
            this.animationFrameId = requestAnimationFrame(animate);
        };
        
        this.animationFrameId = requestAnimationFrame(animate);
    }

    stopDurationAnimation() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    updateDurationDisplay() {
        if (!this.state.stats.startTime || !this.state.isListening || this.state.isPaused) return;
        
        const elapsedSeconds = Math.floor((Date.now() - this.state.stats.startTime - this.state.stats.totalPausedDuration) / 1000);
        const minutes = Math.floor(elapsedSeconds / 60);
        const seconds = elapsedSeconds % 60;
        this.dom['duration-value'].textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    clear() {
        this.state.finalTranscript = '';
        this.state.interimTranscript = '';
        this.state.transcriptLines = [];
        this.state.stats = JSON.parse(JSON.stringify(INITIAL_STATS));
        
        this.updateTranscriptDisplay(true);
        this.updateAllDisplays();
        this.showSuggestion('👋 开始新的练习', 'neutral');
        this.dom['duration-value'].textContent = '00:00';
    }

    addTranscriptLine(text, isFinal) {
        this.state.transcriptLines.push({ text, timestamp: Date.now(), isFinal });
        
        if (this.state.transcriptLines.length > CONFIG.MAX_TRANSCRIPT_LINES) {
            this.state.transcriptLines.shift();
        }
    }

    updateTranscriptDisplay(showPlaceholder = false) {
        if (showPlaceholder) {
            this.dom['transcript-box'].innerHTML = '<div class="placeholder">点击开始练习，我会实时分析你的演讲</div>';
            return;
        }

        const finalLines = this.state.transcriptLines
            .filter(l => l.isFinal)
            .slice(-10)
            .map(l => `<div class="transcript-line final">${this.escapeHtml(l.text)}</div>`)
            .join('');

        const interimHtml = this.state.interimTranscript 
            ? `<div class="transcript-line interim">${this.escapeHtml(this.state.interimTranscript)}</div>` 
            : '';

        const html = finalLines + interimHtml || '<div class="placeholder">等待语音输入...</div>';
        
        this.dom['transcript-box'].innerHTML = html;
        this.dom['transcript-box'].scrollTop = this.dom['transcript-box'].scrollHeight;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    updateStats(text) {
        const words = text.replace(/[，。、；：""''\s]/g, '').length;
        this.state.stats.wordCount += words;
        
        const fillers = text.match(CONFIG.FILLER_PATTERN) || [];
        this.state.stats.fillerCount += fillers.length;
        
        fillers.forEach(filler => {
            if (this.state.stats.fillerBreakdown[filler] !== undefined) {
                this.state.stats.fillerBreakdown[filler]++;
            }
        });
        
        const currentSpeed = this.calculateSpeed();
        const elapsedSeconds = Math.floor((Date.now() - this.state.stats.startTime - this.state.stats.totalPausedDuration) / 1000);
        
        this.state.stats.speedHistory.push({
            speed: currentSpeed,
            elapsedSeconds
        });
        
        if (this.state.stats.speedHistory.length > 30) {
            this.state.stats.speedHistory.shift();
        }
        
        this.state.stats.totalSpeedSamples++;
        this.state.stats.averageSpeed += (currentSpeed - this.state.stats.averageSpeed) / this.state.stats.totalSpeedSamples;
        
        this.updateMetricDisplays();
        this.updateCharts();
        this.generateSuggestions(currentSpeed);
    }

    calculateSpeed() {
        if (!this.state.stats.startTime) return 0;
        
        const elapsedMinutes = (Date.now() - this.state.stats.startTime - this.state.stats.totalPausedDuration) / 60000;
        return elapsedMinutes < 0.1 ? 0 : Math.round(this.state.stats.wordCount / elapsedMinutes);
    }

    updateSpeedDisplay() {
        const speed = this.calculateSpeed();
        this.dom['speed-value'].textContent = speed;
        
        const percent = Math.min(100, (speed / CONFIG.SPEED_WARNING_MAX) * 100);
        if (this.dom.speedProgress) {
            this.dom.speedProgress.style.width = `${percent}%`;
        }
    }

    updateAllDisplays() {
        this.updateMetricDisplays();
        this.updateCharts();
    }

    updateMetricDisplays() {
        this.updateSpeedDisplay();
        
        this.dom['filler-count'].textContent = this.state.stats.fillerCount;
        this.dom['avg-speed-value'].textContent = Math.round(this.state.stats.averageSpeed) || 0;
        
        const sortedFillers = Object.entries(this.state.stats.fillerBreakdown)
            .filter(([_, v]) => v > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        
        if (sortedFillers.length) {
            this.dom['filler-breakdown'].innerHTML = sortedFillers
                .map(([name, value]) => `<span>${name} ${value}</span>`)
                .join(' · ');
        } else {
            this.dom['filler-breakdown'].innerHTML = '<span>暂无语气词</span>';
        }
    }

    updateCharts() {
        if (!this.state.chartsReady) return;
        
        requestAnimationFrame(() => {
            if (this.charts.speed) {
                const dataCount = this.state.stats.speedHistory.length;
                const speeds = this.state.stats.speedHistory.map(d => d.speed);
                const seconds = this.state.stats.speedHistory.map(d => d.elapsedSeconds || 0);
                
                const chartOptions = {
                    xAxis: { 
                        axisLabel: { color: this.getChartTextColor() },
                        rotate: dataCount > 20 ? 30 : 0,
                        interval: dataCount > 25 ? Math.floor(dataCount / 15) : 0,
                        data: seconds
                    },
                    yAxis: {
                        splitLine: { lineStyle: { color: this.getChartLineColor() } },
                        axisLabel: { color: this.getChartTextColor() }
                    },
                    series: [{ 
                        data: speeds,
                        showSymbol: dataCount <= 15,
                        smooth: dataCount > 20 ? 0.8 : true
                    }]
                };

                if (speeds.length > 0) {
                    const maxSpeed = Math.max(...speeds);
                    const minSpeed = Math.min(...speeds);
                    const padding = 20;
                    chartOptions.yAxis.min = Math.max(0, Math.floor(minSpeed - padding));
                    chartOptions.yAxis.max = Math.ceil(maxSpeed + padding);
                }

                if (dataCount > 15) {
                    chartOptions.dataZoom = [{
                        type: 'slider',
                        start: Math.max(0, 100 - 15 / dataCount * 100),
                        end: 100,
                        bottom: 0,
                        height: 20,
                        borderColor: 'transparent',
                        backgroundColor: this.state.isDarkMode ? '#333' : '#f0f0f0',
                        fillerColor: this.state.isDarkMode ? 'rgba(75, 123, 236, 0.3)' : 'rgba(75, 123, 236, 0.2)'
                    }];
                } else {
                    chartOptions.dataZoom = [];
                }

                this.charts.speed.setOption(chartOptions);
            }
            
            if (this.charts.filler) {
                const data = Object.entries(this.state.stats.fillerBreakdown)
                    .filter(([_, v]) => v > 0)
                    .map(([name, value]) => ({ name, value }));
                
                if (data.length === 0) {
                    data.push({ name: '无语气词', value: 1, itemStyle: { color: this.getChartLineColor() } });
                }

                const radius = data.length > 5 ? ['40%', '60%'] : ['50%', '70%'];

                this.charts.filler.setOption({
                    series: [{
                        radius: radius,
                        data: data,
                        label: data.length > 3 ? {
                            show: true,
                            position: 'outside',
                            formatter: '{b}: {d}%',
                            fontSize: 10,
                            color: this.getChartTextColor()
                        } : { show: false }
                    }]
                });
            }
        });
    }

    generateSuggestions(speed) {
        const suggestions = [];
        const { fillerCount, wordCount, averageSpeed, startTime, speedHistory } = this.state.stats;
        
        // 语速相关提示
        if (speed === 0) {
            suggestions.push({ type: 'neutral', text: '🎤 开始说话，我会实时分析你的演讲表现' });
        } else {
            if (speed < CONFIG.SPEED_WARNING_MIN) {
                suggestions.push({ type: 'warning', text: `🐢 当前语速 ${speed}字/分钟，低于理想下限（${CONFIG.SPEED_WARNING_MIN}字/分），听众容易走神` });
                suggestions.push({ type: 'neutral', text: '💡 建议：适当加快语速，增加信息的密度，可以用更少的词表达更多内容' });
            } else if (speed > CONFIG.SPEED_WARNING_MAX) {
                suggestions.push({ type: 'warning', text: `🐇 当前语速 ${speed}字/分钟，超过理想上限（${CONFIG.SPEED_WARNING_MAX}字/分），听众可能跟不上` });
                suggestions.push({ type: 'neutral', text: '💡 建议：适当放慢语速，在重点处停顿，给听众思考的时间' });
            } else if (speed >= CONFIG.NORMAL_SPEED_MIN && speed <= CONFIG.NORMAL_SPEED_MAX) {
                if (speed < 120) {
                    suggestions.push({ type: 'success', text: `✅ 当前语速 ${speed}字/分钟，处于理想范围内，偏向稳重型演讲` });
                } else if (speed > 140) {
                    suggestions.push({ type: 'success', text: `✅ 当前语速 ${speed}字/分钟，处于理想范围内，偏向活跃型演讲` });
                } else {
                    suggestions.push({ type: 'success', text: `✅ 当前语速 ${speed}字/分钟，处于最佳黄金语速区` });
                }
            }
            
            // 语速趋势分析
            if (speedHistory.length >= 3) {
                const recentSpeeds = speedHistory.slice(-3).map(d => d.speed);
                const trend = this.analyzeSpeedTrend(recentSpeeds);
                if (trend === 'increasing') {
                    suggestions.push({ type: 'neutral', text: '📈 语速呈上升趋势，注意不要越来越快' });
                } else if (trend === 'decreasing') {
                    suggestions.push({ type: 'neutral', text: '📉 语速呈下降趋势，注意保持稳定节奏' });
                } else if (trend === 'stable') {
                    suggestions.push({ type: 'success', text: '📊 语速保持稳定，节奏控制得很好' });
                }
            }
            
            // 平均语速分析
            if (averageSpeed > 0) {
                const avg = Math.round(averageSpeed);
                if (avg < CONFIG.SPEED_WARNING_MIN) {
                    suggestions.push({ type: 'warning', text: `📊 平均语速 ${avg}字/分钟，整体偏慢，建议整体提升` });
                } else if (avg > CONFIG.SPEED_WARNING_MAX) {
                    suggestions.push({ type: 'warning', text: `📊 平均语速 ${avg}字/分钟，整体偏快，建议整体放慢` });
                } else if (avg >= CONFIG.NORMAL_SPEED_MIN && avg <= CONFIG.NORMAL_SPEED_MAX) {
                    suggestions.push({ type: 'success', text: `📊 平均语速 ${avg}字/分钟，整体节奏把控得很好` });
                }
            }
            
            // 语速波动分析
            if (speedHistory.length >= 5) {
                const volatility = this.calculateSpeedVolatility();
                if (volatility > 30) {
                    suggestions.push({ type: 'warning', text: '📊 语速波动较大，建议保持更稳定的节奏' });
                } else if (volatility > 15) {
                    suggestions.push({ type: 'neutral', text: '📊 语速有一定波动，可以在重点处变化' });
                } else {
                    suggestions.push({ type: 'success', text: '📊 语速非常稳定，给人一种沉稳自信的感觉' });
                }
            }
        }
        
        // 语气词相关提示
        if (fillerCount > 0) {
            const rate = (fillerCount / (wordCount || 1)) * 100;
            
            if (rate > 20) {
                suggestions.push({ type: 'warning', text: `⚠️ 语气词频率过高（${fillerCount}次，占${rate.toFixed(1)}%），严重影响演讲质量` });
                suggestions.push({ type: 'neutral', text: '💡 尝试用深呼吸或短暂停顿代替语气词' });
            } else if (rate > 10) {
                suggestions.push({ type: 'warning', text: `⚠️ 语气词偏多（${fillerCount}次，占${rate.toFixed(1)}%），容易分散听众注意力` });
                suggestions.push({ type: 'neutral', text: '💡 可以提前准备演讲提纲，减少思考时的停顿填充' });
            } else if (rate > 5) {
                suggestions.push({ type: 'neutral', text: `📊 语气词出现${fillerCount}次，占比${rate.toFixed(1)}%，还有改进空间` });
            } else {
                suggestions.push({ type: 'success', text: `👍 语气词控制良好（${fillerCount}次，仅占${rate.toFixed(1)}%），表达很流畅` });
            }
            
            // 具体语气词分析
            const topFillers = Object.entries(this.state.stats.fillerBreakdown)
                .filter(([_, v]) => v > 0)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 2);
            
            if (topFillers.length > 0) {
                const [filler1, count1] = topFillers[0];
                if (count1 > 5) {
                    suggestions.push({ type: 'neutral', text: `🎯 你最常用"${filler1}"（${count1}次），可以刻意录制自己说话来改善` });
                }
            }
        } else if (wordCount > 50) {
            suggestions.push({ type: 'success', text: '🌟 完美！说了这么多话，一个语气词都没有，非常专业的表达' });
        }
        
        // 时长相关提示
        if (startTime && this.state.isListening && !this.state.isPaused) {
            const elapsedSeconds = (Date.now() - startTime - this.state.stats.totalPausedDuration) / 1000;
            const minutes = Math.floor(elapsedSeconds / 60);
            const seconds = Math.floor(elapsedSeconds % 60);
            
            if (elapsedSeconds < 30) {
                suggestions.push({ type: 'neutral', text: '⏱️ 刚开始练习，放松心态，正常表达就好' });
            } else if (elapsedSeconds >= 30 && elapsedSeconds < 60) {
                suggestions.push({ type: 'neutral', text: '⏱️ 练习即将满1分钟，继续保持' });
            } else if (elapsedSeconds >= 60 && elapsedSeconds < 120) {
                suggestions.push({ type: 'success', text: `⏱️ 已经练习了${minutes}分${seconds}秒，超过1分钟，进入状态了` });
            } else if (elapsedSeconds >= 120 && elapsedSeconds < 180) {
                suggestions.push({ type: 'success', text: `⏱️ 练习了${minutes}分${seconds}秒，超过2分钟，专注力很好` });
            } else if (elapsedSeconds >= 180) {
                suggestions.push({ type: 'success', text: `🎉 超棒！持续练习了${minutes}分${seconds}秒，非常有耐心` });
            }
        }
        
        // 综合建议
        if (wordCount > 200) {
            if (fillerCount === 0 && speed >= 100 && speed <= 160) {
                suggestions.push({ type: 'success', text: '🏆 完美演讲！语速适中，没有语气词，可以应对任何场合' });
            } else if (fillerCount < 5 && speed >= 100 && speed <= 160) {
                suggestions.push({ type: 'success', text: '🎯 整体表现优秀，稍加练习就能达到专业水准' });
            }
        }
        
        // 场景建议
        if (speed > 0) {
            if (speed < 100) {
                suggestions.push({ type: 'neutral', text: '🎯 适合场景：教学、培训、需要强调重点的演讲' });
            } else if (speed > 160) {
                suggestions.push({ type: 'neutral', text: '🎯 适合场景：脱口秀、激情演讲、快速信息传递' });
            } else {
                suggestions.push({ type: 'neutral', text: '🎯 适合场景：面试、汇报、TED演讲、商务谈判' });
            }
        }
        
        this.renderSuggestions(suggestions.slice(0, 4));
    }

    analyzeSpeedTrend(recentSpeeds) {
        if (recentSpeeds.length < 2) return 'stable';
        const first = recentSpeeds[0];
        const last = recentSpeeds[recentSpeeds.length - 1];
        const threshold = 10;
        if (last - first > threshold) return 'increasing';
        if (first - last > threshold) return 'decreasing';
        return 'stable';
    }

    calculateSpeedVolatility() {
        const speeds = this.state.stats.speedHistory.map(d => d.speed);
        if (speeds.length < 2) return 0;
        const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
        const variance = speeds.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / speeds.length;
        return Math.sqrt(variance);
    }

    renderSuggestions(suggestions) {
        if (!suggestions.length) {
            this.dom['suggestions'].innerHTML = '<div class="suggestion-item neutral">👋 开始练习，我会给你实时反馈</div>';
            return;
        }
        
        const html = suggestions.map(s => `<div class="suggestion-item ${s.type}">${s.text}</div>`).join('');
        this.dom['suggestions'].innerHTML = html;
    }

    showSuggestion(text, type = 'neutral') {
        this.dom['suggestions'].innerHTML = `<div class="suggestion-item ${type}">${text}</div>`;
    }

    updateStatus(status, text) {
        this.dom['status-text'].textContent = text;
        this.dom['status-dot'].className = `status-dot ${status !== 'idle' ? status : ''}`;
    }

    updateInterimIndicator(text) {
        this.dom['interim-indicator'].textContent = text;
    }

    updateButtons() {
        this.dom['pause-btn'].disabled = !this.state.isListening;
        
        if (this.state.isPaused) {
            this.updatePauseButtonIcon('pause');
        } else if (this.state.isListening) {
            this.updatePauseButtonIcon('resume');
        }
    }

    updateButtonHTML(btnId, type) {
        const btn = this.dom[btnId];
        if (type === 'start') {
            btn.innerHTML = `
                <svg class="icon" viewBox="0 0 24 24" width="20" height="20">
                    <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.2"/>
                    <circle cx="12" cy="12" r="6" fill="currentColor"/>
                </svg>
                开始练习
            `;
        } else if (type === 'stop') {
            btn.innerHTML = `
                <svg class="icon" viewBox="0 0 24 24" width="20" height="20">
                    <rect x="6" y="6" width="12" height="12" fill="currentColor"/>
                </svg>
                停止练习
            `;
        }
    }

    showError(message) {
        this.dom['transcript-box'].innerHTML = `<div class="error-message">❌ ${message}</div>`;
        this.dom['start-btn'].disabled = true;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.speechCoach = new SpeechCoach();
});

// 添加到 script.js 末尾

// Eel 集成：将重要的统计数据发送到 Python
function syncStatsToPython() {
    if (typeof eel !== 'undefined' && eel.save_analysis_report) {
        const stats = this.state.stats;
        const report = {
            timestamp: new Date().toISOString(),
            total_words: stats.wordCount,
            filler_count: stats.fillerCount,
            average_speed: Math.round(stats.averageSpeed),
            filler_breakdown: stats.fillerBreakdown,
            total_duration: document.getElementById('duration-value')?.textContent || '00:00'
        };
        
        // 可选：定期同步数据（每30秒）
        // eel.save_analysis_report(report);
    }
}

// 在 SpeechCoach 类中添加方法（可选）
// 可以在停止练习时自动保存报告
const originalStop = SpeechCoach.prototype.stop;
SpeechCoach.prototype.stop = function() {
    originalStop.call(this);
    // 停止时自动同步数据
    if (typeof eel !== 'undefined' && eel.save_analysis_report) {
        const stats = this.state.stats;
        if (stats.wordCount > 0) {
            eel.save_analysis_report({
                timestamp: new Date().toISOString(),
                total_words: stats.wordCount,
                filler_count: stats.fillerCount,
                average_speed: Math.round(stats.averageSpeed),
                filler_breakdown: stats.fillerBreakdown,
                speed_history: stats.speedHistory.slice(-20)
            });
        }
    }
};