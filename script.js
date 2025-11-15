// ====== DOM 取得 ======
const gameBoard = document.getElementById("gameBoard");
const fileInput = document.getElementById("fileInput");
const startRoundBtn = document.getElementById("startRoundBtn");
const wordInfo = document.getElementById("wordInfo");
const timeLimitInput = document.getElementById("timeLimitInput");
const soundToggle = document.getElementById("soundToggle");
const generateLinkBtn = document.getElementById("generateLinkBtn");
const linkOutput = document.getElementById("linkOutput");
const modeInfo = document.getElementById("modeInfo");

const timeSpan = document.getElementById("time");
const scoreSpan = document.getElementById("score");
const totalScoreSpan = document.getElementById("totalScore");

// ====== 模式判斷（老師 / 學生） ======
const urlParams = new URLSearchParams(window.location.search);
const gameParam = urlParams.get("game");
let isPlayMode = false;
let presetConfig = null;   // { timeLimit, words: [...] }

// ====== 設定編碼 / 解碼（使用 LZ-String，若失敗改用舊方式） ======

// 產生網址參數用：優先用 LZ-String 壓縮
function encodeConfig(obj) {
    const json = JSON.stringify(obj);
    if (window.LZString) {
        return LZString.compressToEncodedURIComponent(json);
    }
    return encodeURIComponent(json);
}

// 解析網址參數用：先嘗試壓縮格式，失敗再用 decodeURIComponent
function decodeConfig(str) {
    let json = null;

    if (window.LZString) {
        try {
            json = LZString.decompressFromEncodedURIComponent(str);
        } catch (e) {
            json = null;
        }
    }

    if (!json) {
        try {
            json = decodeURIComponent(str);
        } catch (e) {
            console.error("decodeURIComponent 失敗：", e);
            throw e;
        }
    }

    return JSON.parse(json);
}

// ====== 資料與遊戲狀態 ======
let allWordPairs = [];   // { en, zh }

let firstCard = null;
let secondCard = null;
let lockBoard = false;

let globalTimeLimit = 300;  // 老師設定或從網址帶入
let totalTime = 0;
let timerId = null;
let gameTimerRunning = false;

let score = 0;
let totalScore = 0;

// ====== 工具：洗牌 ======
function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = newArray[i];
        newArray[i] = newArray[j];
        newArray[j] = temp;
    }
    return newArray;
}

// ====== Excel 匯入（老師模式用） ======
if (fileInput) {
    fileInput.addEventListener("change", handleFile);
}

function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = function (evt) {
        try {
            const data = new Uint8Array(evt.target.result);
            const workbook = XLSX.read(data, { type: "array" });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];

            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            const pairs = [];

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (!row || row.length < 2) continue;

                const en = String(row[0]).trim();
                const zh = String(row[1]).trim();

                if (!en || !zh) continue;

                // 第一列如果像標題就略過
                const lower = en.toLowerCase();
                if (i === 0 && (lower.includes("english") || lower === "en" || lower === "英文")) {
                    continue;
                }

                pairs.push({ en, zh });
            }

            if (pairs.length === 0) {
                alert("Excel 內容讀取不到有效的「英文 / 中文」資料，請確認前兩欄有內容。");
                allWordPairs = [];
                wordInfo.textContent = "目前尚未匯入單字";
                startRoundBtn.disabled = true;
                return;
            }

            allWordPairs = pairs;
            wordInfo.textContent = `已匯入單字：${allWordPairs.length} 筆（每局會隨機選 8 筆）`;
            startRoundBtn.disabled = false;
        } catch (err) {
            console.error("讀取 Excel 發生錯誤：", err);
            alert("讀取 Excel 檔案時發生錯誤，請確認檔案格式是否為 .xlsx 或 .xls，再試一次。");
        }
    };

    reader.readAsArrayBuffer(file);
}

// ====== 開始新一局 ======
if (startRoundBtn) {
    startRoundBtn.addEventListener("click", () => {
        if (allWordPairs.length < 1) {
            alert("請先匯入至少 1 筆單字資料的 Excel 檔。");
            return;
        }

        // 第一次按下時才啟動全局倒數
        if (!gameTimerRunning) {
            startGlobalTimer();
        }

        startNewRound();
    });
}

function startNewRound() {
    resetBoardState();
    gameBoard.innerHTML = "";

    const neededPairs = 8;
    const shuffledPairs = shuffleArray(allWordPairs);
    const selectedPairs = shuffledPairs.slice(0, Math.min(neededPairs, shuffledPairs.length));

    if (selectedPairs.length < neededPairs) {
        alert(`目前只有 ${selectedPairs.length} 組單字，會用這些來進行遊戲（不足 8 組）。`);
    }

    const cardsData = [];

    selectedPairs.forEach((pair, index) => {
        const pairId = "pair_" + index;
        cardsData.push({
            text: pair.en,
            pairId: pairId,
            lang: "en-US"
        });
        cardsData.push({
            text: pair.zh,
            pairId: pairId,
            lang: "zh-TW"
        });
    });

    const shuffledCards = shuffleArray(cardsData);

    score = 0;
    updateScoreDisplay();

    shuffledCards.forEach(data => {
        const card = createCard(data);
        gameBoard.appendChild(card);
    });
}

function resetBoardState() {
    firstCard = null;
    secondCard = null;
    lockBoard = false;
}

// ====== 建立卡片 ======
function createCard(cardData) {
    const card = document.createElement("div");
    card.classList.add("card");
    card.dataset.text = cardData.text;
    card.dataset.pairId = cardData.pairId;
    card.dataset.lang = cardData.lang;

    card.textContent = "";

    card.addEventListener("click", onCardClick);

    return card;
}

// ====== 點擊卡片 ======
function onCardClick(event) {
    if (!gameTimerRunning) {
        return;
    }

    const card = event.currentTarget;

    if (lockBoard) return;
    if (card.classList.contains("flipped") || card.classList.contains("matched")) return;
    if (card === firstCard) return;

    card.classList.add("flipped");
    card.textContent = card.dataset.text;

    if (soundToggle && soundToggle.checked) {
        speakText(card.dataset.text, card.dataset.lang);
    }

    if (!firstCard) {
        firstCard = card;
    } else {
        secondCard = card;
        checkMatch();
    }
}

function checkMatch() {
    const isMatch = firstCard.dataset.pairId === secondCard.dataset.pairId;

    if (isMatch) {
        handleMatchSuccess();
    } else {
        unflipCards();
    }
}

function handleMatchSuccess() {
    firstCard.classList.add("matched");
    secondCard.classList.add("matched");

    score += 10;
    totalScore += 10;
    updateScoreDisplay();
    updateTotalScoreDisplay();

    firstCard = null;
    secondCard = null;

    checkAllMatched();
}

function unflipCards() {
    lockBoard = true;

    setTimeout(() => {
        firstCard.classList.remove("flipped");
        firstCard.textContent = "";

        secondCard.classList.remove("flipped");
        secondCard.textContent = "";

        firstCard = null;
        secondCard = null;
        lockBoard = false;
    }, 800);
}

function checkAllMatched() {
    const cards = document.querySelectorAll(".card");
    const allMatched = Array.from(cards).every(card => card.classList.contains("matched"));

    if (allMatched) {
        alert(`這一局完成！本局得到 ${score} 分，目前累積總分：${totalScore} 分。`);
    }
}

// ====== 全局倒數計時 ======
function startGlobalTimer() {
    if (!isPlayMode) {
        // 老師模式：由老師輸入時間限制
        let inputVal = parseInt(timeLimitInput.value, 10);
        if (isNaN(inputVal) || inputVal <= 0) {
            inputVal = 300;
        }
        globalTimeLimit = inputVal;
    }
    // 學生模式：用老師預先設定好的 globalTimeLimit

    totalTime = globalTimeLimit;
    updateTimeDisplay();

    gameTimerRunning = true;
    totalScore = 0;
    updateTotalScoreDisplay();
    score = 0;
    updateScoreDisplay();

    timerId = setInterval(() => {
        totalTime--;
        if (totalTime < 0) totalTime = 0;
        updateTimeDisplay();

        if (totalTime <= 0) {
            endGameTimeUp();
        }
    }, 1000);
}

function updateTimeDisplay() {
    if (timeSpan) {
        timeSpan.textContent = totalTime;
    }
}

function endGameTimeUp() {
    clearInterval(timerId);
    timerId = null;
    gameTimerRunning = false;
    totalTime = 0;
    updateTimeDisplay();

    startRoundBtn.disabled = true;
    lockBoard = true;

    alert(`時間到了！本次總分為：${totalScore} 分。若要重新開始，請重新整理頁面或重新掃描 QR。`);
}

// ====== 分數顯示 ======
function updateScoreDisplay() {
    if (scoreSpan) {
        scoreSpan.textContent = score;
    }
}

function updateTotalScoreDisplay() {
    if (totalScoreSpan) {
        totalScoreSpan.textContent = totalScore;
    }
}

// ====== 語音朗讀 ======
function speakText(text, lang) {
    if (!("speechSynthesis" in window)) {
        return;
    }

    window.speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang || "en-US";
    utter.rate = 1;
    utter.pitch = 1;

    window.speechSynthesis.speak(utter);
}

// ====== 產生遊戲連結（老師模式用） ======
if (generateLinkBtn) {
    generateLinkBtn.addEventListener("click", () => {
        if (allWordPairs.length === 0) {
            alert("請先匯入單字 Excel 檔。");
            return;
        }

        let inputVal = parseInt(timeLimitInput.value, 10);
        if (isNaN(inputVal) || inputVal <= 0) {
            inputVal = 300;
        }

        const config = {
            timeLimit: inputVal,
            words: allWordPairs
        };

        const encoded = encodeConfig(config);
        const baseUrl = window.location.origin + window.location.pathname; // 例如 /flip-card-game/
        const fullUrl = baseUrl + "?game=" + encoded;

        linkOutput.value = fullUrl;
        alert("已產生遊戲連結！\n請複製下方連結，拿去產生 QR Code 給學生掃描。");
    });
}

// ====== 初始化模式（老師 / 學生） ======
function initMode() {
    if (gameParam) {
        // 學生模式
        try {
            presetConfig = decodeConfig(gameParam);
            isPlayMode = true;
        } catch (e) {
            alert("讀取遊戲設定失敗，請確認連結是否正確。將回到老師模式。");
            console.error("解析 game 參數失敗：", e);
            isPlayMode = false;
        }
    }

    if (isPlayMode && presetConfig) {
        // 學生模式：隱藏老師設定區塊
        document.querySelectorAll(".admin-only").forEach(el => {
            el.style.display = "none";
        });

        modeInfo.textContent = "模式：玩家（由老師預先設定時間與單字）";

        allWordPairs = presetConfig.words || [];
        globalTimeLimit = presetConfig.timeLimit || 300;

        if (allWordPairs.length === 0) {
            wordInfo.textContent = "本遊戲設定錯誤：沒有單字。";
            startRoundBtn.disabled = true;
        } else {
            wordInfo.textContent = `本遊戲共有 ${allWordPairs.length} 筆單字，每局隨機出現 8 筆。`;
            startRoundBtn.disabled = false;
        }

        timeSpan.textContent = globalTimeLimit;
    } else {
        // 老師模式
        isPlayMode = false;
        modeInfo.textContent = "模式：老師（匯入 Excel、設定時間後產生遊戲連結）";
        startRoundBtn.disabled = true;
        timeSpan.textContent = 0;
    }
}

initMode();
