import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Trophy,
  Users,
  Award,
  RotateCcw,
  Play,
  CheckCircle2,
  Volume2,
  VolumeX,
  Sparkles,
  BarChart3,
  X,
  History,
  Info,
  Clock
} from 'lucide-react';

// ==========================================
// 核心数据：概率表 (Strictly following spec)
// ==========================================
export const PROBABILITY_TABLE = {
  '一等奖': {
    '普通客户': [13, 3, 4, 6, 7, 11, 17, 23, 8, 8],
    'VIP':     [11, 2, 4, 5, 6, 10, 15, 23, 12, 12],
    '自己人':   [9, 1, 3, 4, 6, 9, 15, 23, 15, 15]
  },
  '二等奖': {
    '普通客户': [3, 11, 16, 18, 18, 15, 11, 6, 1, 1],
    'VIP':     [3, 11, 15, 17, 17, 15, 11, 6, 3, 2],
    '自己人':   [3, 11, 14, 16, 16, 14, 11, 6, 5, 4]
  },
  '三等奖': {
    '普通客户': [19, 17, 16, 13, 11, 9, 7, 5, 2, 1],
    'VIP':     [18, 16, 15, 13, 11, 9, 7, 5, 4, 2],
    '自己人':   [17, 15, 14, 12, 11, 9, 7, 5, 6, 4]
  },
  '四等奖': {
    '普通客户': [27, 22, 17, 13, 9, 6, 4, 2, 0, 0],
    'VIP':     [26, 21, 17, 13, 9, 6, 4, 2, 1, 1],
    '自己人':   [25, 20, 17, 13, 9, 6, 4, 2, 2, 2]
  }
} as const;

export type CustomerType = '普通客户' | 'VIP' | '自己人';
export type PrizeTier = '一等奖' | '二等奖' | '三等奖' | '四等奖';

export interface DrawRecord {
  id: string;
  roundNumber: number;
  resultNumber: number;
  customerType: CustomerType;
  prizeTier: PrizeTier;
  timestamp: string;
}

// ==========================================
// Web Audio 声音合成器 (免外部音频资源)
// ==========================================
class SoundEffects {
  private ctx: AudioContext | null = null;

  private initContext() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playTick() {
    try {
      this.initContext();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(680, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(120, this.ctx.currentTime + 0.035);

      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.035);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.035);
    } catch {
      // Audio playback fails silently if restricted
    }
  }

  playWin() {
    try {
      this.initContext();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6 arpeggio

      notes.forEach((freq, idx) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.09);

        gain.gain.setValueAtTime(0.18, now + idx * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.35);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + idx * 0.09);
        osc.stop(now + idx * 0.09 + 0.36);
      });
    } catch {
      // Audio playback fails silently
    }
  }
}

const soundManager = new SoundEffects();

// ==========================================
// 轮盘加权随机抽样算法 (Cumulative Distribution)
// ==========================================
function weightedRandomPick(weights: readonly number[]): number {
  const sum = weights.reduce((acc, val) => acc + val, 0);
  const rand = Math.random() * sum;
  let running = 0;
  for (let i = 0; i < weights.length; i++) {
    running += weights[i];
    if (rand < running) {
      return i + 1; // 对应数字 1 ~ 10
    }
  }
  return weights.length;
}

// ==========================================
// 转盘扇区视觉生成辅助
// ==========================================
const TOTAL_SECTORS = 10;
const SECTOR_ANGLE = 360 / TOTAL_SECTORS; // 36 degrees
const WHEEL_RADIUS = 180;
const WHEEL_CENTER = 200;

// 计算极坐标到直角坐标（0度为正上方 12点钟）
function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
  const radians = (angleInDegrees * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.sin(radians),
    y: centerY - radius * Math.cos(radians)
  };
}

// 生成扇区 SVG Path
function createSectorPath(k: number) {
  // Sector k (1..10) 的中心角为 (k - 1) * 36°
  const midAngle = (k - 1) * SECTOR_ANGLE;
  const startAngle = midAngle - SECTOR_ANGLE / 2;
  const endAngle = midAngle + SECTOR_ANGLE / 2;

  const start = polarToCartesian(WHEEL_CENTER, WHEEL_CENTER, WHEEL_RADIUS, startAngle);
  const end = polarToCartesian(WHEEL_CENTER, WHEEL_CENTER, WHEEL_RADIUS, endAngle);

  return `M ${WHEEL_CENTER} ${WHEEL_CENTER} L ${start.x} ${start.y} A ${WHEEL_RADIUS} ${WHEEL_RADIUS} 0 0 1 ${end.x} ${end.y} Z`;
}

export default function App() {
  // 1. 状态管理
  const [customerType, setCustomerType] = useState<CustomerType | null>(null);
  const [prizeTier, setPrizeTier] = useState<PrizeTier | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [currentRotation, setCurrentRotation] = useState(0);
  const [drawHistory, setDrawHistory] = useState<DrawRecord[]>([]);
  const [showResultModal, setShowResultModal] = useState(false);

  // 辅助视觉状态
  const [lastDrawnNumber, setLastDrawnNumber] = useState<number | null>(null);
  const [isNeedleWobbling, setIsNeedleWobbling] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showProbabilityPreview, setShowProbabilityPreview] = useState(false);

  const historyEndRef = useRef<HTMLDivElement>(null);
  const spinTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tickIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
    };
  }, []);

  // 记录追加时自动滚动到底部
  useEffect(() => {
    if (drawHistory.length > 0) {
      historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [drawHistory]);

  // 当前选中组合的概率表
  const currentProbabilities = useMemo(() => {
    if (!customerType || !prizeTier) return null;
    return PROBABILITY_TABLE[prizeTier][customerType];
  }, [customerType, prizeTier]);

  // 判断是否可抽奖
  const canSpin = customerType !== null && prizeTier !== null && !isSpinning;

  // 2. 抽奖动作 (严格按照交互流程实现)
  const handleSpinClick = () => {
    if (!customerType || !prizeTier || isSpinning) return;

    const probabilities = PROBABILITY_TABLE[prizeTier][customerType];
    const pickedNumber = weightedRandomPick(probabilities);

    setIsSpinning(true);
    setLastDrawnNumber(null);

    // 计算目标角度：
    // 指针固定在顶部 12 点钟 (0°)。
    // 扇区 k 初始中心角为 (k - 1) * 36°。
    // 转盘顺时针旋转 R 度后，扇区 k 到达 ( (k - 1)*36 + R ) mod 360 = 0。
    // 即基准停止角度 baseAngle = (360 - (k - 1) * 36) % 360。
    const targetBaseAngle = (360 - (pickedNumber - 1) * SECTOR_ANGLE) % 360;
    const currentNorm = currentRotation % 360;
    const delta = (targetBaseAngle - currentNorm + 360) % 360;

    // 旋转圈数：固定 6 圈 (2160°) + 到达目标格子的增量 delta
    const fullRounds = 6 * 360;
    const nextTargetRotation = currentRotation + fullRounds + delta;

    setCurrentRotation(nextTargetRotation);

    // 播放转盘减速齿轮音效
    if (soundEnabled) {
      let tickCount = 0;
      const totalTicks = 32;
      const tick = () => {
        soundManager.playTick();
        tickCount++;
        if (tickCount < totalTicks) {
          // 随时间推移间隔变长，模拟转盘减速
          const delay = 45 + Math.pow(tickCount / totalTicks, 2) * 220;
          tickIntervalRef.current = setTimeout(tick, delay);
        }
      };
      tick();
    }

    // 动画持续时间 3600ms
    const animationDuration = 3600;
    spinTimeoutRef.current = setTimeout(() => {
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);

      setIsSpinning(false);
      setLastDrawnNumber(pickedNumber);
      setIsNeedleWobbling(true);

      if (soundEnabled) {
        soundManager.playWin();
      }

      setTimeout(() => setIsNeedleWobbling(false), 800);

      // 追加记录
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
      setDrawHistory(prev => [
        ...prev,
        {
          id: `${Date.now()}-${prev.length + 1}`,
          roundNumber: prev.length + 1,
          resultNumber: pickedNumber,
          customerType,
          prizeTier,
          timestamp: timeStr
        }
      ]);
    }, animationDuration);
  };

  // 3. 重新抽奖 (立即清空记录，转盘归位，保留客户类型和奖级)
  const handleResetClick = () => {
    if (isSpinning) return;
    if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
    if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);

    setDrawHistory([]);
    setCurrentRotation(0);
    setLastDrawnNumber(null);
  };

  // 4. 结束抽奖 (展示统计弹窗)
  const handleEndDrawClick = () => {
    if (isSpinning) return;
    setShowResultModal(true);
  };

  // 5. 弹窗关闭 (关闭弹窗，同时清空记录，转盘归位)
  const handleModalCloseClick = () => {
    setShowResultModal(false);
    setDrawHistory([]);
    setCurrentRotation(0);
    setLastDrawnNumber(null);
  };

  // 统计结果数据处理：按数字从小到大排序展示，格式：1中5次、5中2次（只展示出现过的数字）
  const statistics = useMemo(() => {
    if (drawHistory.length === 0) return [];
    const countMap: Record<number, number> = {};
    drawHistory.forEach(record => {
      countMap[record.resultNumber] = (countMap[record.resultNumber] || 0) + 1;
    });

    const items = Object.entries(countMap)
      .map(([numStr, count]) => ({
        number: parseInt(numStr, 10),
        count,
        percent: Math.round((count / drawHistory.length) * 100)
      }))
      .sort((a, b) => a.number - b.number);

    return items;
  }, [drawHistory]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans selection:bg-amber-500 selection:text-slate-950">
      {/* 顶部导航栏 */}
      <header className="border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-md sticky top-0 z-20 px-4 py-3 sm:px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-rose-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Sparkles className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white flex items-center gap-2">
                Spin the Wheel <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">数字转盘</span>
              </h1>
              <p className="text-xs text-slate-400 hidden sm:block">多客户类型与奖级独立概率轮盘系统</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              id="toggle-sound-btn"
              onClick={() => setSoundEnabled(!soundEnabled)}
              title={soundEnabled ? '静音' : '开启音效'}
              className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition-colors border border-slate-700/50"
            >
              {soundEnabled ? <Volume2 className="w-4 h-4 text-amber-400" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
            </button>
            <button
              id="toggle-prob-preview-btn"
              onClick={() => setShowProbabilityPreview(!showProbabilityPreview)}
              className={`text-xs px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors border ${
                showProbabilityPreview
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700/50'
              }`}
            >
              <Info className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">概率预览</span>
            </button>
          </div>
        </div>
      </header>

      {/* 主体工作区 */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col gap-6">
        
        {/* 控制区容器：客户类型选择与奖级选择 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          {/* 一、客户类型选择区 */}
          <section id="customer-type-section" className="bg-slate-950/60 border border-slate-800/90 rounded-2xl p-4 sm:p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <Users className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-semibold tracking-wide text-slate-200">1. 客户类型选择</h2>
              </div>
              <span className="text-xs text-amber-400/80 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">单选</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['普通客户', 'VIP', '自己人'] as CustomerType[]).map((type) => {
                const isSelected = customerType === type;
                return (
                  <button
                    key={type}
                    id={`customer-type-${type}`}
                    disabled={isSpinning}
                    onClick={() => setCustomerType(type)}
                    className={`py-3 px-2 rounded-xl text-xs sm:text-sm font-medium transition-all flex flex-col items-center justify-center gap-1 border ${
                      isSelected
                        ? 'bg-gradient-to-b from-amber-500/20 to-amber-600/10 border-amber-500/60 text-amber-300 shadow-md shadow-amber-500/10'
                        : 'bg-slate-900/80 hover:bg-slate-850 border-slate-800 text-slate-400 hover:text-slate-200'
                    } ${isSpinning ? 'opacity-50 cursor-not-allowed' : 'active:scale-98'}`}
                  >
                    <span className="font-semibold">{type}</span>
                    <span className="text-[10px] text-slate-500">{isSelected ? '✓ 已选中' : '点击选择'}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 二、奖级选择区 */}
          <section id="prize-tier-section" className="bg-slate-950/60 border border-slate-800/90 rounded-2xl p-4 sm:p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <Award className="w-4 h-4 text-rose-400" />
                <h2 className="text-sm font-semibold tracking-wide text-slate-200">2. 奖级选择</h2>
              </div>
              <span className="text-xs text-rose-400/80 bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20">单选</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {(['一等奖', '二等奖', '三等奖', '四等奖'] as PrizeTier[]).map((tier) => {
                const isSelected = prizeTier === tier;
                return (
                  <button
                    key={tier}
                    id={`prize-tier-${tier}`}
                    disabled={isSpinning}
                    onClick={() => setPrizeTier(tier)}
                    className={`py-3 px-1.5 rounded-xl text-xs sm:text-sm font-medium transition-all flex flex-col items-center justify-center gap-1 border ${
                      isSelected
                        ? 'bg-gradient-to-b from-rose-500/20 to-rose-600/10 border-rose-500/60 text-rose-300 shadow-md shadow-rose-500/10'
                        : 'bg-slate-900/80 hover:bg-slate-850 border-slate-800 text-slate-400 hover:text-slate-200'
                    } ${isSpinning ? 'opacity-50 cursor-not-allowed' : 'active:scale-98'}`}
                  >
                    <span className="font-semibold">{tier}</span>
                    <span className="text-[10px] text-slate-500">{isSelected ? '✓ 已选中' : '选择'}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        {/* 展开的概率预览抽屉 (可选但便于验证) */}
        {showProbabilityPreview && (
          <div className="bg-slate-950/80 border border-amber-500/30 rounded-2xl p-4 transition-all">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-amber-300 flex items-center gap-2">
                <Info className="w-3.5 h-3.5" />
                当前配置概率表：{customerType || '未选客户'} + {prizeTier || '未选奖级'}
              </div>
              <span className="text-[11px] text-slate-400">各数字中奖几率 (1~10)</span>
            </div>
            {currentProbabilities ? (
              <div className="grid grid-cols-5 sm:grid-cols-10 gap-1.5 text-center">
                {currentProbabilities.map((pct, idx) => (
                  <div key={idx} className="bg-slate-900/90 border border-slate-800 rounded-lg p-1.5">
                    <div className="text-xs font-bold text-amber-400">#{idx + 1}</div>
                    <div className="text-xs font-mono text-slate-300">{pct}%</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic">请先选择客户类型和奖级以查看对应的具体概率分布。</p>
            )}
          </div>
        )}

        {/* 主转盘与记录分栏布局 */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* 三、转盘区与操作按钮区 */}
          <div className="lg:col-span-7 flex flex-col items-center bg-slate-950/40 border border-slate-800/80 rounded-3xl p-6 sm:p-8 relative overflow-hidden">
            
            {/* 背景氛围晕染 */}
            <div className="absolute -top-24 -left-24 w-72 h-72 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -right-24 w-72 h-72 bg-rose-500/5 rounded-full blur-3xl pointer-events-none" />

            {/* 当前模式状态指示条 */}
            <div className="w-full flex items-center justify-between mb-6 px-2 text-xs">
              <div className="flex items-center gap-2 text-slate-400">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>当前配置：</span>
                <span className="font-semibold text-slate-200">
                  {customerType && prizeTier ? `${customerType} · ${prizeTier}` : '请先选择上方配置'}
                </span>
              </div>
              {lastDrawnNumber !== null && !isSpinning && (
                <div className="flex items-center gap-1 text-amber-400 font-bold bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/30 animate-fade-in">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>最新抽中：数字 {lastDrawnNumber}</span>
                </div>
              )}
            </div>

            {/* 转盘舞台容器 */}
            <div className="relative w-full max-w-[340px] sm:max-w-[390px] aspect-square flex items-center justify-center my-2">
              
              {/* 外部固定指针 (12 点钟方向，朝下对准选中的扇区) */}
              <div
                className={`absolute top-0 left-1/2 -translate-x-1/2 -translate-y-2 z-30 transition-transform duration-300 origin-top pointer-events-none ${
                  isNeedleWobbling ? 'animate-bounce' : ''
                }`}
                style={{
                  transform: isNeedleWobbling
                    ? 'translateX(-50%) rotate(0deg) scale(1.1)'
                    : 'translateX(-50%)'
                }}
              >
                <div className="flex flex-col items-center">
                  {/* 指针主体带发光质感 */}
                  <div className="w-7 h-10 relative filter drop-shadow-[0_4px_8px_rgba(0,0,0,0.6)]">
                    {/* SVG 精致指针 */}
                    <svg viewBox="0 0 28 40" className="w-full h-full">
                      <defs>
                        <linearGradient id="pointerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#FBBF24" />
                          <stop offset="50%" stopColor="#F59E0B" />
                          <stop offset="100%" stopColor="#B45309" />
                        </linearGradient>
                      </defs>
                      <path
                        d="M 14 38 L 4 10 Q 14 0 24 10 Z"
                        fill="url(#pointerGrad)"
                        stroke="#FFF"
                        strokeWidth="1.5"
                      />
                      <circle cx="14" cy="11" r="4" fill="#991B1B" stroke="#FDE68A" strokeWidth="1" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* 外圈装饰金属质感圈 (固定不转) */}
              <div className="absolute inset-0 rounded-full border-4 border-slate-700/80 shadow-[0_0_35px_rgba(0,0,0,0.8)_inset] pointer-events-none z-10">
                {/* 环形分布的 20 个金铆钉装饰 */}
                {Array.from({ length: 20 }).map((_, i) => {
                  const angle = i * (360 / 20);
                  const pos = polarToCartesian(50, 50, 48.5, angle);
                  return (
                    <div
                      key={i}
                      className="absolute w-1.5 h-1.5 rounded-full bg-gradient-to-tr from-amber-300 to-amber-500 shadow-sm transform -translate-x-1/2 -translate-y-1/2"
                      style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                    />
                  );
                })}
              </div>

              {/* 核心旋转转盘 SVG */}
              <div
                id="spinning-wheel-disc"
                className="w-full h-full rounded-full transition-transform"
                style={{
                  transform: `rotate(${currentRotation}deg)`,
                  transition: isSpinning
                    ? 'transform 3.6s cubic-bezier(0.18, 0.92, 0.22, 1)'
                    : currentRotation === 0
                    ? 'transform 0.4s ease-out'
                    : 'none'
                }}
              >
                <svg
                  viewBox={`0 0 ${WHEEL_CENTER * 2} ${WHEEL_CENTER * 2}`}
                  className="w-full h-full filter drop-shadow-2xl select-none"
                >
                  <defs>
                    {/* 主题渐变色 A：典雅深红 */}
                    <linearGradient id="gradRuby" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#E11D48" />
                      <stop offset="100%" stopColor="#9F1239" />
                    </linearGradient>

                    {/* 主题渐变色 B：奢雅暖琥珀金 */}
                    <linearGradient id="gradGold" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#D97706" />
                      <stop offset="100%" stopColor="#B45309" />
                    </linearGradient>

                    {/* 扇区中奖高亮金光 */}
                    <radialGradient id="gradHighlight" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#FEF08A" stopOpacity="0.8" />
                      <stop offset="100%" stopColor="#CA8A04" stopOpacity="0.1" />
                    </radialGradient>
                  </defs>

                  {/* 10 个扇区路径绘制 (数字 1~10 顺时针排列) */}
                  {Array.from({ length: TOTAL_SECTORS }).map((_, idx) => {
                    const sectorNumber = idx + 1;
                    const isEven = sectorNumber % 2 === 0;
                    const isWinner = !isSpinning && lastDrawnNumber === sectorNumber;

                    // 计算该扇区的文本标签位置与旋转角度
                    const midAngle = (sectorNumber - 1) * SECTOR_ANGLE;
                    const textPos = polarToCartesian(WHEEL_CENTER, WHEEL_CENTER, 125, midAngle);

                    return (
                      <g key={sectorNumber} id={`wheel-sector-${sectorNumber}`}>
                        {/* 扇区扇形 */}
                        <path
                          d={createSectorPath(sectorNumber)}
                          fill={isEven ? 'url(#gradGold)' : 'url(#gradRuby)'}
                          stroke="#1E293B"
                          strokeWidth="2"
                          className="transition-colors duration-200"
                        />

                        {/* 扇区高亮滤层（中奖停稳时） */}
                        {isWinner && (
                          <path
                            d={createSectorPath(sectorNumber)}
                            fill="url(#gradHighlight)"
                            className="animate-pulse"
                          />
                        )}

                        {/* 扇区数字标签 (顺时针旋转对齐，面向外圈) */}
                        <text
                          x={textPos.x}
                          y={textPos.y}
                          fill="#FFFFFF"
                          fontSize="24"
                          fontWeight="800"
                          fontFamily="system-ui, -apple-system, sans-serif"
                          textAnchor="middle"
                          dominantBaseline="central"
                          transform={`rotate(${midAngle}, ${textPos.x}, ${textPos.y})`}
                          style={{
                            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.6))'
                          }}
                        >
                          {sectorNumber}
                        </text>
                      </g>
                    );
                  })}

                  {/* 转盘同心圆装饰细线 */}
                  <circle
                    cx={WHEEL_CENTER}
                    cy={WHEEL_CENTER}
                    r={WHEEL_RADIUS - 10}
                    fill="none"
                    stroke="#FEF3C7"
                    strokeWidth="1"
                    strokeDasharray="4 6"
                    opacity="0.3"
                  />
                  <circle
                    cx={WHEEL_CENTER}
                    cy={WHEEL_CENTER}
                    r={65}
                    fill="none"
                    stroke="#FEF3C7"
                    strokeWidth="1.5"
                    opacity="0.25"
                  />
                </svg>
              </div>

              {/* 转盘中心固定圆盘装饰 (中央轴心) */}
              <div className="absolute w-20 h-20 rounded-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 border-4 border-amber-400/90 shadow-[0_0_20px_rgba(0,0,0,0.8)] z-20 flex flex-col items-center justify-center pointer-events-none">
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center shadow-inner">
                  <Trophy className="w-7 h-7 text-slate-950 drop-shadow" />
                </div>
              </div>

            </div>

            {/* 提示信息：未选择时提示 */}
            {!canSpin && !isSpinning && (
              <div className="text-xs text-amber-400/90 flex items-center gap-1.5 mt-2 bg-amber-500/10 px-3 py-1.5 rounded-full border border-amber-500/20">
                <Info className="w-3.5 h-3.5" />
                <span>请先在上方选择「客户类型」和「奖级」，方可启动抽奖</span>
              </div>
            )}

            {/* 四、操作按钮区 (严格按照要求：抽奖、重新抽奖、结束抽奖) */}
            <div className="w-full max-w-md grid grid-cols-3 gap-3 mt-6">
              {/* 抽奖按钮 */}
              <button
                id="btn-spin"
                disabled={!canSpin}
                onClick={handleSpinClick}
                className={`py-3.5 px-3 rounded-xl font-bold text-sm tracking-wide transition-all shadow-lg flex items-center justify-center gap-2 ${
                  canSpin
                    ? 'bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-slate-950 shadow-amber-500/25 active:scale-97 cursor-pointer'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50 shadow-none'
                }`}
              >
                <Play className="w-4 h-4 fill-current" />
                <span>{isSpinning ? '抽奖中...' : '抽奖'}</span>
              </button>

              {/* 重新抽奖按钮 */}
              <button
                id="btn-reset"
                disabled={isSpinning}
                onClick={handleResetClick}
                className={`py-3.5 px-3 rounded-xl font-semibold text-sm transition-all border flex items-center justify-center gap-1.5 ${
                  isSpinning
                    ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed'
                    : 'bg-slate-900/90 hover:bg-slate-800 border-slate-700 text-slate-200 active:scale-97 hover:border-slate-600 cursor-pointer'
                }`}
              >
                <RotateCcw className="w-4 h-4 text-slate-400" />
                <span>重新抽奖</span>
              </button>

              {/* 结束抽奖按钮 */}
              <button
                id="btn-end-draw"
                disabled={isSpinning}
                onClick={handleEndDrawClick}
                className={`py-3.5 px-3 rounded-xl font-semibold text-sm transition-all border flex items-center justify-center gap-1.5 ${
                  isSpinning
                    ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed'
                    : 'bg-slate-900/90 hover:bg-rose-950/40 border-slate-700 text-rose-300 hover:border-rose-500/50 active:scale-97 cursor-pointer'
                }`}
              >
                <CheckCircle2 className="w-4 h-4 text-rose-400" />
                <span>结束抽奖</span>
              </button>
            </div>

          </div>

          {/* 五、本轮抽奖记录区 */}
          <div className="lg:col-span-5 flex flex-col bg-slate-950/60 border border-slate-800/90 rounded-3xl p-5 sm:p-6 shadow-sm min-h-[480px] lg:h-[620px]">
            
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <History className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-bold text-slate-200">本轮抽奖记录</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs bg-slate-800 text-slate-300 px-2.5 py-1 rounded-full font-mono font-medium">
                  共 {drawHistory.length} 次
                </span>
              </div>
            </div>

            {/* 记录列表 (随着抽奖次数向下追加) */}
            <div className="flex-1 overflow-y-auto py-3 space-y-2 pr-1 custom-scrollbar">
              {drawHistory.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-500">
                  <div className="w-12 h-12 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-center justify-center mb-3 text-slate-600">
                    <History className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-medium text-slate-400">暂无抽奖记录</p>
                  <p className="text-xs text-slate-600 mt-1 max-w-[200px]">
                    选择客户类型与奖级后，点击「抽奖」开始游戏
                  </p>
                </div>
              ) : (
                drawHistory.map((item) => (
                  <div
                    key={item.id}
                    id={`history-item-${item.roundNumber}`}
                    className="flex items-center justify-between p-3 rounded-xl bg-slate-900/80 border border-slate-800/80 hover:border-slate-700/80 transition-colors animate-fade-in"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center text-xs font-mono font-bold text-slate-400">
                        {item.roundNumber}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-slate-200">
                          第 {item.roundNumber} 次：抽中数字 <span className="text-amber-400 font-bold">{item.resultNumber}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                          <span>{item.customerType}</span>
                          <span>·</span>
                          <span>{item.prizeTier}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {item.timestamp}
                      </span>
                      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-amber-500 to-rose-500 flex items-center justify-center font-bold text-xs text-slate-950 shadow-sm">
                        {item.resultNumber}
                      </div>
                    </div>
                  </div>
                ))
              )}
              <div ref={historyEndRef} />
            </div>

            {/* 底部摘要小贴士 */}
            {drawHistory.length > 0 && (
              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                <span>最新：第 {drawHistory.length} 次抽中 {drawHistory[drawHistory.length - 1].resultNumber}</span>
                <button
                  onClick={handleEndDrawClick}
                  className="text-amber-400 hover:text-amber-300 font-medium underline underline-offset-2"
                >
                  查看统计详情
                </button>
              </div>
            )}

          </div>

        </div>

      </main>

      {/* 底部页脚 */}
      <footer className="border-t border-slate-800/60 py-4 px-6 text-center text-xs text-slate-500">
        <span>Spin the Wheel · 数字转盘抽奖系统 · 严格遵循概率配置</span>
      </footer>

      {/* 六、结果统计弹窗 (Modal) */}
      {showResultModal && (
        <div
          id="result-modal-backdrop"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
        >
          <div
            id="result-modal-container"
            className="w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl p-6 sm:p-7 relative max-h-[90vh] flex flex-col"
          >
            {/* 弹窗顶部标题 */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
                  <BarChart3 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">本轮抽奖结果统计</h3>
                  <p className="text-xs text-slate-400">按数字从小到大排序展示</p>
                </div>
              </div>
              <button
                id="btn-modal-close-icon"
                onClick={handleModalCloseClick}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 弹窗主体内容 */}
            <div className="flex-1 overflow-y-auto py-5 space-y-4">
              {drawHistory.length === 0 ? (
                // 友好提示：本轮一次都没抽过奖
                <div className="text-center py-8">
                  <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-3 text-slate-400">
                    <Info className="w-6 h-6" />
                  </div>
                  <p className="text-base font-medium text-slate-300">本轮还没有抽奖记录</p>
                  <p className="text-xs text-slate-500 mt-1">
                    请先进行抽奖，产生记录后再来查看详细统计哦。
                  </p>
                </div>
              ) : (
                <>
                  {/* 格式化统计文本行展示 */}
                  <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4">
                    <div className="text-xs font-semibold text-amber-400 mb-2">中奖摘要（仅展示出现过的数字）：</div>
                    <div className="flex flex-wrap gap-2 text-sm text-slate-200">
                      {statistics.map((item, idx) => (
                        <span
                          key={item.number}
                          className="inline-flex items-center px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700/70 text-slate-200 font-mono text-xs"
                        >
                          <strong className="text-amber-400 mr-1">{item.number}</strong>
                          中 {item.count} 次
                          {idx < statistics.length - 1 && <span className="text-slate-600 ml-2">、</span>}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* 详细条形柱状图可视化 */}
                  <div className="space-y-2.5 pt-1">
                    <div className="text-xs font-semibold text-slate-400 px-1">
                      各数字出现频次分布（共 {drawHistory.length} 次）：
                    </div>
                    {statistics.map(item => (
                      <div
                        key={item.number}
                        className="bg-slate-950/50 border border-slate-800/80 rounded-xl p-2.5 flex items-center gap-3"
                      >
                        <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 font-bold flex items-center justify-center text-sm border border-amber-500/30">
                          {item.number}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-slate-200 font-medium">数字 {item.number}：中奖 {item.count} 次</span>
                            <span className="text-slate-400 font-mono">{item.percent}%</span>
                          </div>
                          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-amber-500 to-rose-500 rounded-full transition-all duration-500"
                              style={{ width: `${item.percent}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* 弹窗底部操作按钮 */}
            <div className="pt-4 border-t border-slate-800 flex justify-end">
              <button
                id="btn-modal-close"
                onClick={handleModalCloseClick}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-sm transition-all shadow-md active:scale-98 cursor-pointer"
              >
                关闭并重置
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
