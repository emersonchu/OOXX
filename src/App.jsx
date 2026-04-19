import { useEffect, useRef, useState, useCallback } from "react";
import "./App.css";


// 換成你在 Render 部署後拿到的網址
const SERVER_HOST = "your-app-name.onrender.com";
const WS_URL = `wss://${SERVER_HOST}/ws`;
const HEALTH_URL = `https://${SERVER_HOST}/health`;


const WAKE_TIMEOUT_SEC = 45;  // 冷啟動預估上限


export default function App() {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const wsRef = useRef(null);


  const [board, setBoard] = useState(Array(9).fill(null));
  const [currentPlayer, setCurrentPlayer] = useState("X");
  const [result, setResult] = useState(null);
  const [canvasSize, setCanvasSize] = useState(0);


  // 'idle' | 'waking' | 'waiting' | 'playing'
  const [phase, setPhase] = useState("idle");
  const [wakeProgress, setWakeProgress] = useState(0);
  const [roomId, setRoomId] = useState(null);
  const [mySymbol, setMySymbol] = useState(null);


  // ─── 畫布尺寸 ───
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      setCanvasSize(Math.floor(Math.min(rect.width, rect.height)));
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);


  // ─── 繪製 ───
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize === 0) return;
    const ctx = canvas.getContext("2d");
    const S = canvasSize;
    const cell = S / 3;


    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = "#ecf0f1";
    ctx.fillRect(0, 0, S, S);


    ctx.strokeStyle = "#34495e";
    ctx.lineWidth = Math.max(2, S * 0.008);
    ctx.lineCap = "round";
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cell, S * 0.05);
      ctx.lineTo(i * cell, S * 0.95);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(S * 0.05, i * cell);
      ctx.lineTo(S * 0.95, i * cell);
      ctx.stroke();
    }


    ctx.lineWidth = Math.max(4, S * 0.02);
    board.forEach((mark, i) => {
      if (!mark) return;
      const row = Math.floor(i / 3);
      const col = i % 3;
      const cx = col * cell + cell / 2;
      const cy = row * cell + cell / 2;
      const r = cell * 0.28;
      if (mark === "X") {
        ctx.strokeStyle = "#e74c3c";
        ctx.beginPath();
        ctx.moveTo(cx - r, cy - r);
        ctx.lineTo(cx + r, cy + r);
        ctx.moveTo(cx + r, cy - r);
        ctx.lineTo(cx - r, cy + r);
        ctx.stroke();
      } else {
        ctx.strokeStyle = "#3498db";
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    });


    if (result && result.line) {
      const [a, , c] = result.line;
      const getXY = (idx) => {
        const r = Math.floor(idx / 3);
        const co = idx % 3;
        return [co * cell + cell / 2, r * cell + cell / 2];
      };
      const [x1, y1] = getXY(a);
      const [x2, y2] = getXY(c);
      ctx.strokeStyle = "#f1c40f";
      ctx.lineWidth = Math.max(6, S * 0.025);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }, [board, canvasSize, result]);


  // ─── 建立 WS 連線 ───
  const openSocket = useCallback(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;


    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "j" }));
    };


    ws.onmessage = (e) => {
      const d = JSON.parse(e.data);
      switch (d.t) {
        case "w": // waiting
          setPhase("waiting");
          break;
        case "m": // matched
          setRoomId(d.r);
          setMySymbol(d.s);
          setCurrentPlayer(d.c);
          setBoard(Array(9).fill(null));
          setResult(null);
          setPhase("playing");
          break;
        case "u": // update（只給位置 + 換誰 + 結果）
          setBoard((prev) => {
            const next = [...prev];
            next[d.i] = d.p;
            return next;
          });
          setCurrentPlayer(d.c);
          if (d.r) {
            setResult({ winner: d.r.w, line: d.r.l });
          }
          break;
        case "rs": // reset
          setBoard(Array(9).fill(null));
          setCurrentPlayer(d.c);
          setResult(null);
          break;
        default:
          break;
      }
    };


    ws.onerror = () => {
      alert("連線失敗，請稍後再試。");
      setPhase("idle");
    };
  }, []);


  // ─── 喚醒伺服器（冷啟動）後再連 WS ───
  const startMatchmaking = useCallback(async () => {
    setPhase("waking");
    setWakeProgress(0);


    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setWakeProgress(Math.min(95, (elapsed / WAKE_TIMEOUT_SEC) * 100));
    }, 500);


    try {
      // 用 fetch 喚醒伺服器；失敗就重試直到 timeout
      const deadline = Date.now() + WAKE_TIMEOUT_SEC * 1000;
      let awake = false;
      while (Date.now() < deadline && !awake) {
        try {
          const res = await fetch(HEALTH_URL, { cache: "no-store" });
          if (res.ok) {
            awake = true;
            break;
          }
        } catch {
          /* 伺服器還沒醒，繼續等 */
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      clearInterval(timer);


      if (!awake) {
        alert("伺服器喚醒逾時，請稍後再試。");
        setPhase("idle");
        return;
      }


      setWakeProgress(100);
      openSocket();
    } catch {
      clearInterval(timer);
      setPhase("idle");
    }
  }, [openSocket]);


  const handleClick = (e) => {
    if (phase !== "playing" || result) return;
    if (currentPlayer !== mySymbol) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const cell = canvasSize / 3;
    const idx = Math.floor(y / cell) * 3 + Math.floor(x / cell);
    if (idx < 0 || idx > 8 || board[idx]) return;
    wsRef.current?.send(JSON.stringify({ t: "mv", i: idx }));
  };


  const resetGame = () => {
    wsRef.current?.send(JSON.stringify({ t: "r" }));
  };


  let statusText = "";
  let isWin = false;
  if (phase === "playing") {
    if (result) {
      if (result.winner === "draw") statusText = "平手！";
      else if (result.winner === mySymbol) {
        statusText = `你贏了！(${result.winner})`;
        isWin = true;
      } else statusText = `你輸了 (${result.winner} 勝)`;
    } else {
      statusText = currentPlayer === mySymbol
        ? `輪到你了 (${mySymbol})`
        : `等待對手 (${currentPlayer})`;
    }
  }


  return (
    <div className="app">
      <div className="info">
        {phase === "playing" && (
          <>
            <span className="room-tag">房號 {roomId}</span>
            <span className="my-symbol">你是 {mySymbol}</span>
            <span className={`status ${isWin ? "win" : ""}`}>{statusText}</span>
            <button className="reset-btn" onClick={resetGame}>
              重新開始
            </button>
          </>
        )}
      </div>


      <div className="board-container" ref={containerRef}>
        {canvasSize > 0 && (
          <canvas
            ref={canvasRef}
            width={canvasSize}
            height={canvasSize}
            onClick={handleClick}
            className="board"
          />
        )}
      </div>


      {phase === "idle" && (
        <div className="overlay">
          <div className="dialog">
            <h2>線上 井字遊戲</h2>
            <p>按下按鈕自動配對對手</p>
            <button className="primary-btn" onClick={startMatchmaking}>
              開始配對
            </button>
            <p className="hint">首次連線需等待約 30 秒喚醒伺服器</p>
          </div>
        </div>
      )}


      {phase === "waking" && (
        <div className="overlay">
          <div className="dialog">
            <h2>喚醒伺服器中…</h2>
            <p>免費方案休眠後，首次啟動約需 30 秒</p>
            <div className="progress-wrap">
              <div
                className="progress-bar"
                style={{ width: `${wakeProgress}%` }}
              />
            </div>
            <p className="hint">{Math.round(wakeProgress)}%</p>
          </div>
        </div>
      )}


      {phase === "waiting" && (
        <div className="overlay">
          <div className="dialog">
            <h2>等待對手加入…</h2>
            <p>把網址分享給朋友，請他一起按「開始配對」</p>
          </div>
        </div>
      )}
    </div>
  );
}


