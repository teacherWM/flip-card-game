let gameConfig = null;
let timeLeft = 0;
let timerId = null;
let score = 0;
let gameActive = false;

let firstCard = null;
let secondCard = null;
let lockBoard = false;

// ✅ 新增：語音是否開啟（預設 true）
let voiceEnabled = true;

window.addEventListener("DOMContentLoaded", () => {
  const configFromHash = loadConfigFromHash();

  if (configFromHash) {
    // 學生模式
    gameConfig = configFromHash;
    document.getElementById("teacher-panel").classList.add("hidden");
    document.getElementById("game-section").classList.remove("hidden");
    setupStudentUI();
  } else {
    // 老師模式
    document.getElementById("teacher-panel").classList.remove("hidden");
    document.getElementById("game-section").classList.add("hidden");
    setupTeacherUI();
  }
});

/* ============================
   老師模式
============================ */

function setupTeacherUI() {
  const msg = document.getElementById("teacher-message");

  document.getElementById("generateBtn").onclick = async () => {
    msg.textContent = "";

    const file = document.getElementById("excelFile").files[0];
    const time = parseInt(document.getElementById("timeLimit").value, 10);

    if (!file) {
      msg.textContent = "請選擇 Excel 檔案！";
      return;
    }
    if (!time || time <= 0) {
      msg.textContent = "請輸入大於 0 的時間！";
      return;
    }

    try {
      const pairs = await readExcel(file);
      if (!pairs.length) {
        msg.textContent = "Excel 無有效資料（A欄英文、B欄中文）。";
        return;
      }

      gameConfig = { timeLimit: time, pairs };

      const encoded = btoa(encodeURIComponent(JSON.stringify(gameConfig)));
      const url = location.href.split("#")[0] + "#data=" + encoded;

      document.getElementById("share-link").value = url;
      document.getElementById("share-area").classList.remove("hidden");
      msg.textContent = "已產生學生連結！";

      document.getElementById("copyBtn").onclick = () => {
        navigator.clipboard.writeText(url);
        alert("已複製學生連結！");
      };

      // 預覽學生模式
      document.getElementById("game-section").classList.remove("hidden");
      setupStudentUI();
    } catch (e) {
      console.error(e);
      msg.textContent = "解析 Excel 失敗，請確認檔案格式。";
    }
  };
}

function readExcel(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const result = [];

      rows.forEach((r, i) => {
        if (!r || r.length < 2) return;
        const en = String(r[0]).trim();
        const zh = String(r[1]).trim();
        if (i === 0 && (en.includes("英") || zh.includes("中"))) return; // 第一列標題就略過
        if (en && zh) result.push({ en, zh });
      });

      resolve(result);
    };
    reader.readAsArrayBuffer(file);
  });
}

/* ============================
   學生模式與遊戲邏輯
============================ */

function setupStudentUI() {
  if (!gameConfig) return;
  timeLeft = gameConfig.timeLimit;
  score = 0;

  document.getElementById("timeDisplay").textContent = timeLeft;
  document.getElementById("scoreDisplay").textContent = score;
  document.getElementById("game-message").textContent = "";

  // ✅ 綁定語音開關
  const toggle = document.getElementById("voiceToggle");
  if (toggle) {
    toggle.checked = voiceEnabled;
    toggle.onchange = () => {
      voiceEnabled = toggle.checked;
      // 關掉語音時順便停止目前播放的語音
      if (!voiceEnabled && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }

  const startBtn = document.getElementById("startBtn");
  startBtn.disabled = false;
  startBtn.textContent = "Start";
  startBtn.onclick = startGame;

  buildRoundCards();
}

function startGame() {
  if (!gameConfig) return;

  clearInterval(timerId);
  timeLeft = gameConfig.timeLimit;
  score = 0;
  gameActive = true;
  lockBoard = false;
  firstCard = null;
  secondCard = null;

  document.getElementById("timeDisplay").textContent = timeLeft;
  document.getElementById("scoreDisplay").textContent = score;
  document.getElementById("game-message").textContent = "";

  buildRoundCards();

  const startBtn = document.getElementById("startBtn");
  startBtn.disabled = true;
  startBtn.textContent = "遊戲中…";

  timerId = setInterval(() => {
    timeLeft--;
    if (timeLeft <= 0) {
      timeLeft = 0;
      document.getElementById("timeDisplay").textContent = timeLeft;
      endGame();          // 直接結束遊戲
    } else {
      document.getElementById("timeDisplay").textContent = timeLeft;
    }
  }, 1000);
}

function endGame() {
  if (!gameActive) return; // 避免被叫多次

  clearInterval(timerId);
  timerId = null;
  gameActive = false;
  lockBoard = true;
  timeLeft = 0;
  document.getElementById("timeDisplay").textContent = "0";

  const msg = document.getElementById("game-message");
  msg.textContent = `時間到！你的分數是 ${score} 分。`;

  const startBtn = document.getElementById("startBtn");
  startBtn.disabled = true;
  startBtn.textContent = "時間到";
}

// 建立一輪 4x4 牌組
function buildRoundCards() {
  if (!gameConfig || !Array.isArray(gameConfig.pairs)) return;

  const board = document.getElementById("gameBoard");
  board.innerHTML = "";

  firstCard = null;
  secondCard = null;
  lockBoard = false;

  const pool = [...gameConfig.pairs];
  shuffle(pool);
  const selected = pool.slice(0, Math.min(8, pool.length)); // 8 組

  const cards = [];
  selected.forEach((p, i) => {
    cards.push({ id: i, text: p.en });
    cards.push({ id: i, text: p.zh });
  });

  shuffle(cards);

  cards.forEach((c) => {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.id = c.id;

    const inner = document.createElement("div");
    inner.className = "card-inner";

    const front = document.createElement("div");
    front.className = "card-face card-front";
    front.textContent = c.text;

    const back = document.createElement("div");
    back.className = "card-face card-back";

    inner.append(front, back);
    card.append(inner);

    card.onclick = () => handleCardClick(card);

    board.append(card);
  });
}

function handleCardClick(card) {
  if (!gameActive) return;       // 遊戲沒開始或已結束
  if (lockBoard) return;
  if (card.classList.contains("flipped")) return;

  card.classList.add("flipped");

  // 翻牌後立即語音（如果有開）
  const text = card.querySelector(".card-front").textContent;
  speakText(text);

  if (!firstCard) {
    firstCard = card;
    return;
  }

  secondCard = card;
  lockBoard = true;

  const isMatch = firstCard.dataset.id === secondCard.dataset.id;

  if (isMatch) {
    firstCard.classList.add("matched");
    secondCard.classList.add("matched");
    score++;
    document.getElementById("scoreDisplay").textContent = score;
    resetTurn();

    // 檢查是否本輪全部配對完成
    const matchedCount = document.querySelectorAll(".card.matched").length;
    const totalCards = document.querySelectorAll(".card").length;

    if (matchedCount === totalCards) {
      // 還有時間就進入下一輪，分數保留
      if (timeLeft > 0 && gameActive) {
        document.getElementById("game-message").textContent = "太棒了！下一輪開始～";
        setTimeout(() => {
          if (gameActive && timeLeft > 0) {
            document.getElementById("game-message").textContent = "";
            buildRoundCards();
          }
        }, 800);
      }
    }
  } else {
    setTimeout(() => {
      firstCard.classList.remove("flipped");
      secondCard.classList.remove("flipped");
      resetTurn();
    }, 600);
  }
}

function resetTurn() {
  [firstCard, secondCard, lockBoard] = [null, null, false];
}

/* ============================
   工具函式
============================ */

function loadConfigFromHash() {
  if (!location.hash.startsWith("#data=")) return null;
  try {
    const encoded = location.hash.slice(6);
    const json = decodeURIComponent(atob(encoded));
    return JSON.parse(json);
  } catch (e) {
    console.error("解析 #data 失敗：", e);
    return null;
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function speakText(text) {
  // ✅ 若關閉語音，直接不播
  if (!voiceEnabled) return;
  if (!("speechSynthesis" in window)) return;

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = /[a-zA-Z]/.test(text) ? "en-US" : "zh-TW";
  utter.rate = 1.2;
  window.speechSynthesis.cancel();  // 先停掉前一句，避免疊音
  window.speechSynthesis.speak(utter);
}
