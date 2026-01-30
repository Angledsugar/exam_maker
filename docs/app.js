const SECTION_ORDER = ["vocabulary", "grammar", "reading"];
const DATA_URL = "data/select_test.json";

const state = {
  source: [],
  questions: [],
  index: 0,
  score: 0,
  correct: 0,
  answered: 0,
  wrong: [],
  groupTotals: new Map(),
  groupScores: new Map(),
  groupState: {},
  totalPossible: 0,
  currentChoices: [],
  currentAnswered: false,
};

const elements = {};

function normalizeSection(section) {
  if (section === null || section === undefined) {
    return "";
  }
  return String(section).trim().toLowerCase();
}

function shuffleInPlace(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
}

function shuffleQuestionsBySection(questions) {
  const bySection = {
    vocabulary: [],
    grammar: [],
    reading: [],
  };

  questions.forEach((q) => {
    const sec = normalizeSection(q.section);
    if (bySection[sec]) {
      bySection[sec].push(q);
    }
  });

  const shuffled = [];
  SECTION_ORDER.forEach((sec) => {
    const items = bySection[sec];
    shuffleInPlace(items);
    shuffled.push(...items);
  });

  return shuffled;
}

function formatHeader(question, index, total) {
  const section = normalizeSection(question.section);
  if (section === "reading") {
    const unit = question.unit;
    const qnum = question.question_num;
    const page = question.page;
    const parts = ["Reading"];
    if (unit !== null && unit !== undefined) {
      parts.push(String(unit));
    }
    if (qnum !== null && qnum !== undefined) {
      parts.push(String(qnum));
    }
    let label = parts.join(" ");
    if (page !== null && page !== undefined) {
      label = `${label} (p.${page})`;
    }
    return `[${index}/${total}] ${label}`;
  }

  const sectionLabel = section ? section.charAt(0).toUpperCase() + section.slice(1) : "";
  const qnum = question.question_num;
  const parts = [`[${index}/${total}]`];
  if (sectionLabel) {
    parts.push(sectionLabel);
  }
  if (qnum !== null && qnum !== undefined) {
    parts.push(`Q${qnum}`);
  }
  return parts.join(" ");
}

function buildChoiceSet(question) {
  const choices = Array.isArray(question.choice) ? question.choice : [];
  const answer = question.answer;
  const prepared = choices.map((choice) => ({
    text: choice,
    isCorrect: answer !== null && answer !== undefined && choice === answer,
  }));
  shuffleInPlace(prepared);
  return prepared;
}

function countQuestionTypes(questions) {
  let onePointCount = 0;
  const groupIds = new Set();
  questions.forEach((q) => {
    const groupId = q.special_list;
    if (groupId === null || groupId === undefined) {
      onePointCount += 1;
    } else {
      groupIds.add(String(groupId));
    }
  });
  return { onePointCount, twoPointGroups: groupIds.size };
}

function initGroupScoring(questions) {
  state.groupTotals = new Map();
  state.groupScores = new Map();
  state.groupState = {};
  let nonGroupPossible = 0;

  questions.forEach((q) => {
    const groupId = q.special_list;
    const scoreValue = Number.isFinite(Number(q.score)) ? Number(q.score) : 1;
    if (groupId === null || groupId === undefined) {
      nonGroupPossible += scoreValue;
    } else {
      const key = String(groupId);
      state.groupTotals.set(key, (state.groupTotals.get(key) || 0) + 1);
      if (!state.groupScores.has(key)) {
        state.groupScores.set(key, scoreValue);
      }
    }
  });

  state.groupTotals.forEach((_, key) => {
    state.groupState[key] = { allCorrect: true, answered: 0 };
  });

  let groupPossible = 0;
  state.groupScores.forEach((value) => {
    groupPossible += value;
  });

  state.totalPossible = nonGroupPossible + groupPossible;
}

function finalizeGroupScore() {
  let groupPoints = 0;
  state.groupTotals.forEach((total, key) => {
    const groupState = state.groupState[key];
    if (!groupState) {
      return;
    }
    if (groupState.allCorrect && groupState.answered === total) {
      groupPoints += state.groupScores.get(key) || 0;
    }
  });
  return groupPoints;
}

function resetState() {
  state.questions = [];
  state.index = 0;
  state.score = 0;
  state.correct = 0;
  state.answered = 0;
  state.wrong = [];
  state.currentChoices = [];
  state.currentAnswered = false;
}

function renderCounts() {
  const counts = countQuestionTypes(state.questions.length ? state.questions : state.source);
  elements.counts.textContent = `1-point questions: ${counts.onePointCount} | 2-point groups: ${counts.twoPointGroups}`;
}

function showNote(message) {
  elements.note.textContent = message || "";
}

function setQuizVisible(isVisible) {
  elements.quiz.classList.toggle("hidden", !isVisible);
}

function setSummaryVisible(isVisible) {
  elements.summary.classList.toggle("hidden", !isVisible);
}

function renderQuestion() {
  const question = state.questions[state.index];
  if (!question) {
    finishQuiz();
    return;
  }

  state.currentChoices = buildChoiceSet(question);
  state.currentAnswered = false;

  elements.progress.textContent = `Question ${state.index + 1} / ${state.questions.length}`;
  elements.header.textContent = formatHeader(question, state.index + 1, state.questions.length);
  elements.question.textContent = question.question || "";

  elements.choices.innerHTML = "";
  state.currentChoices.forEach((choice, idx) => {
    const button = document.createElement("button");
    button.className = "choice-btn";
    const label = String.fromCharCode(65 + idx);
    button.textContent = `${label}. ${choice.text}`;
    button.addEventListener("click", () => handleAnswer(idx));
    elements.choices.appendChild(button);
  });

  elements.feedback.textContent = "";
  elements.nextBtn.disabled = true;
  elements.skipBtn.disabled = false;
}

function handleAnswer(choiceIndex) {
  if (state.currentAnswered) {
    return;
  }

  const question = state.questions[state.index];
  const groupId = question.special_list;
  const groupKey = groupId === null || groupId === undefined ? null : String(groupId);
  const choice = state.currentChoices[choiceIndex];
  const buttons = elements.choices.querySelectorAll("button");

  state.currentAnswered = true;
  state.answered += 1;

  buttons.forEach((button, idx) => {
    button.disabled = true;
    if (state.currentChoices[idx].isCorrect) {
      button.classList.add("correct");
    }
  });

  if (choice.isCorrect) {
    state.correct += 1;
    if (!groupKey) {
      const scoreValue = Number.isFinite(Number(question.score)) ? Number(question.score) : 1;
      state.score += scoreValue;
    }
    elements.feedback.textContent = "Correct!";
  } else {
    buttons[choiceIndex].classList.add("incorrect");
    elements.feedback.textContent = "Incorrect.";
    const wrongEntry = {
      ...question,
      user_choice: choice.text,
      correct_answer: question.answer,
      presented_choices: state.currentChoices.map((c) => c.text),
    };
    state.wrong.push(wrongEntry);
    if (groupKey) {
      state.groupState[groupKey].allCorrect = false;
    }
  }

  if (groupKey) {
    state.groupState[groupKey].answered += 1;
  }

  elements.skipBtn.disabled = true;
  elements.nextBtn.disabled = false;
}

function skipQuestion() {
  if (state.currentAnswered) {
    return;
  }
  const question = state.questions[state.index];
  const groupId = question.special_list;
  const groupKey = groupId === null || groupId === undefined ? null : String(groupId);
  if (groupKey) {
    state.groupState[groupKey].allCorrect = false;
  }
  state.currentAnswered = true;
  elements.feedback.textContent = "Skipped.";
  elements.skipBtn.disabled = true;
  elements.nextBtn.disabled = false;
}

function nextQuestion() {
  state.index += 1;
  if (state.index >= state.questions.length) {
    finishQuiz();
  } else {
    renderQuestion();
  }
}

function finishQuiz() {
  setQuizVisible(false);
  setSummaryVisible(true);

  const finalScore = state.score + finalizeGroupScore();
  const accuracy = state.answered ? (state.correct / state.answered) * 100 : 0;

  elements.summaryText.innerHTML = `
    Answered: ${state.answered}<br />
    Correct: ${state.correct}<br />
    Accuracy: ${accuracy.toFixed(1)}%<br />
    Score: ${finalScore} / ${state.totalPossible} (${state.totalPossible ? ((finalScore / state.totalPossible) * 100).toFixed(1) : "0.0"}%)
  `;

  elements.downloadBtn.disabled = false;
}

function downloadWrongQuestions() {
  const data = JSON.stringify(state.wrong, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const timestamp = formatTimestamp(new Date());
  const filename = `wrong_questions_${timestamp}.json`;

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());
  return `${year}${month}${day}_${hour}${minute}${second}`;
}

function startQuiz() {
  resetState();
  state.questions = shuffleQuestionsBySection(state.source);
  initGroupScoring(state.questions);
  renderCounts();
  setSummaryVisible(false);
  setQuizVisible(true);
  elements.resetBtn.disabled = false;
  renderQuestion();
}

function resetQuiz() {
  resetState();
  setQuizVisible(false);
  setSummaryVisible(false);
  elements.resetBtn.disabled = true;
  elements.downloadBtn.disabled = true;
  showNote("Ready.");
}

async function loadData() {
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load data: ${response.status}`);
    }
    const data = await response.json();
    const selected = [];
    let unknownCount = 0;
    const bySection = {
      vocabulary: [],
      grammar: [],
      reading: [],
    };

    data.forEach((q) => {
      const sec = normalizeSection(q.section);
      if (bySection[sec]) {
        bySection[sec].push(q);
      } else {
        unknownCount += 1;
      }
    });

    SECTION_ORDER.forEach((sec) => {
      selected.push(...bySection[sec]);
    });

    state.source = selected;
    renderCounts();

    if (unknownCount) {
      showNote(`${unknownCount} question(s) had unknown sections and were skipped.`);
    } else {
      showNote("Ready.");
    }
  } catch (error) {
    showNote("Failed to load question data.");
    console.error(error);
  }
}

function bindEvents() {
  elements.startBtn.addEventListener("click", startQuiz);
  elements.resetBtn.addEventListener("click", resetQuiz);
  elements.skipBtn.addEventListener("click", skipQuestion);
  elements.nextBtn.addEventListener("click", nextQuestion);
  elements.downloadBtn.addEventListener("click", downloadWrongQuestions);
}

document.addEventListener("DOMContentLoaded", () => {
  elements.startBtn = document.getElementById("start-btn");
  elements.resetBtn = document.getElementById("reset-btn");
  elements.skipBtn = document.getElementById("skip-btn");
  elements.nextBtn = document.getElementById("next-btn");
  elements.downloadBtn = document.getElementById("download-btn");
  elements.counts = document.getElementById("counts");
  elements.note = document.getElementById("note");
  elements.quiz = document.getElementById("quiz");
  elements.summary = document.getElementById("summary");
  elements.progress = document.getElementById("progress");
  elements.header = document.getElementById("header");
  elements.question = document.getElementById("question");
  elements.choices = document.getElementById("choices");
  elements.feedback = document.getElementById("feedback");
  elements.summaryText = document.getElementById("summary-text");

  bindEvents();
  loadData();
});
