const SECTION_ORDER = ["vocabulary", "grammar", "reading"];
const DATA_URL = "data/select_test.json";
const PAGE_SIZE = 10;

const state = {
  source: [],
  sections: [],
  sectionIndex: 0,
  pageIndex: 0,
  answers: new Map(),
  choiceOrder: new Map(),
  wrong: [],
  totalPossible: 0,
  groupTotals: new Map(),
  groupScores: new Map(),
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

function formatHeader(sectionKey) {
  if (sectionKey === "reading") {
    return "Reading";
  }
  if (sectionKey) {
    return sectionKey.charAt(0).toUpperCase() + sectionKey.slice(1);
  }
  return "";
}

function formatQuestionHeader(question) {
  const section = normalizeSection(question.section);
  if (section === "reading") {
    const unit = question.unit;
    const qnum = question.question_num;
    const page = question.page;
    const parts = ["Reading"];
    if (unit !== null && unit !== undefined) {
      parts.push(`Unit:${unit}`);
    }
    if (qnum !== null && qnum !== undefined) {
      parts.push(`Q:${qnum}`);
    }
    let label = parts.join(" ");
    if (page !== null && page !== undefined) {
      label = `${label} (p.${page})`;
    }
    return label;
  }

  const sectionLabel = section ? section.charAt(0).toUpperCase() + section.slice(1) : "";
  const qnum = question.question_num;
  const parts = [];
  if (sectionLabel) {
    parts.push(sectionLabel);
  }
  if (qnum !== null && qnum !== undefined) {
    parts.push(`Q${qnum}`);
  }
  return parts.join(" ");
}

function buildChoiceSet(question) {
  const cached = state.choiceOrder.get(question._id);
  if (cached) {
    return cached;
  }
  const choices = Array.isArray(question.choice) ? question.choice : [];
  const answer = question.answer;
  const prepared = choices.map((choice) => ({
    text: choice,
    isCorrect: answer !== null && answer !== undefined && choice === answer,
  }));
  shuffleInPlace(prepared);
  state.choiceOrder.set(question._id, prepared);
  return prepared;
}

function buildSections(questions) {
  const bySection = {
    vocabulary: [],
    grammar: [],
    reading: [],
  };

  questions.forEach((q, idx) => {
    const sec = normalizeSection(q.section);
    if (!bySection[sec]) {
      return;
    }
    bySection[sec].push({
      ...q,
      _id: idx,
    });
  });

  return SECTION_ORDER.map((sec) => ({
    key: sec,
    label: formatHeader(sec),
    questions: bySection[sec],
  }));
}

function chunkQuestions(questions) {
  const pages = [];
  for (let i = 0; i < questions.length; i += PAGE_SIZE) {
    pages.push(questions.slice(i, i + PAGE_SIZE));
  }
  return pages;
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

  let groupPossible = 0;
  state.groupScores.forEach((value) => {
    groupPossible += value;
  });

  state.totalPossible = nonGroupPossible + groupPossible;
}

function resetState() {
  state.sections = [];
  state.sectionIndex = 0;
  state.pageIndex = 0;
  state.answers = new Map();
  state.choiceOrder = new Map();
  state.wrong = [];
}

function renderCounts() {
  const counts = countQuestionTypes(state.source);
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

function currentSection() {
  return state.sections[state.sectionIndex];
}

function currentPageQuestions() {
  const section = currentSection();
  if (!section) {
    return [];
  }
  const pages = chunkQuestions(section.questions);
  return pages[state.pageIndex] || [];
}

function renderPage() {
  const section = currentSection();
  if (!section) {
    finishQuiz();
    return;
  }

  const pages = chunkQuestions(section.questions);
  if (state.pageIndex >= pages.length) {
    state.pageIndex = 0;
  }

  const pageQuestions = pages[state.pageIndex] || [];
  elements.sectionProgress.textContent = `Section: ${section.label} (${state.sectionIndex + 1}/${state.sections.length})`;
  elements.pageProgress.textContent = `Page ${state.pageIndex + 1} / ${pages.length}`;
  elements.header.textContent = section.label;

  elements.questionGrid.innerHTML = "";
  pageQuestions.forEach((question, idx) => {
    const card = document.createElement("div");
    card.className = "question-card";

    const title = document.createElement("h3");
    title.textContent = `${idx + 1}. ${formatQuestionHeader(question)}`;
    card.appendChild(title);

    const prompt = document.createElement("div");
    prompt.textContent = question.question || "";
    card.appendChild(prompt);

    const choiceList = document.createElement("div");
    choiceList.className = "choice-list";
    const prepared = buildChoiceSet(question);

    prepared.forEach((choice, choiceIndex) => {
      const label = document.createElement("label");
      label.className = "choice-item";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `q_${question._id}`;
      radio.value = choiceIndex;
      radio.checked = state.answers.get(question._id)?.index === choiceIndex;
      radio.addEventListener("change", () => {
        state.answers.set(question._id, {
          index: choiceIndex,
          choice,
          prepared,
          question,
        });
      });

      const text = document.createElement("span");
      const labelChar = String.fromCharCode(65 + choiceIndex);
      text.textContent = `${labelChar}. ${choice.text}`;

      label.appendChild(radio);
      label.appendChild(text);
      choiceList.appendChild(label);
    });

    card.appendChild(choiceList);
    elements.questionGrid.appendChild(card);
  });

  elements.prevBtn.disabled = state.sectionIndex === 0 && state.pageIndex === 0;
  elements.nextBtn.textContent =
    state.sectionIndex === state.sections.length - 1 && state.pageIndex === pages.length - 1
      ? "Finish"
      : "Next";
}

function goPrev() {
  const section = currentSection();
  if (!section) {
    return;
  }
  const pages = chunkQuestions(section.questions);
  if (state.pageIndex > 0) {
    state.pageIndex -= 1;
    renderPage();
    return;
  }
  if (state.sectionIndex > 0) {
    state.sectionIndex -= 1;
    const prevSection = currentSection();
    const prevPages = chunkQuestions(prevSection.questions);
    state.pageIndex = Math.max(prevPages.length - 1, 0);
    renderPage();
  }
}

function goNext() {
  const section = currentSection();
  if (!section) {
    return;
  }
  const pages = chunkQuestions(section.questions);
  if (state.pageIndex < pages.length - 1) {
    state.pageIndex += 1;
    renderPage();
    return;
  }

  if (state.sectionIndex < state.sections.length - 1) {
    state.sectionIndex += 1;
    state.pageIndex = 0;
    renderPage();
    return;
  }

  finishQuiz();
}

function finishQuiz() {
  setQuizVisible(false);
  setSummaryVisible(true);

  let answered = 0;
  let correct = 0;
  let score = 0;
  let onePointCorrect = 0;

  const groupState = {};
  state.groupTotals.forEach((total, key) => {
    groupState[key] = { allCorrect: true, answered: 0, total };
  });

  state.sections.forEach((section) => {
    section.questions.forEach((question) => {
      const entry = state.answers.get(question._id);
      if (!entry) {
        if (question.special_list !== null && question.special_list !== undefined) {
          const key = String(question.special_list);
          if (groupState[key]) {
            groupState[key].allCorrect = false;
          }
        }
        return;
      }

      answered += 1;
      const isCorrect = entry.choice?.isCorrect;
      if (isCorrect) {
        correct += 1;
      }

      if (question.special_list === null || question.special_list === undefined) {
        if (isCorrect) {
          const scoreValue = Number.isFinite(Number(question.score)) ? Number(question.score) : 1;
          score += scoreValue;
          onePointCorrect += 1;
        }
      } else {
        const key = String(question.special_list);
        if (groupState[key]) {
          groupState[key].answered += 1;
          if (!isCorrect) {
            groupState[key].allCorrect = false;
          }
        }
      }

      if (!isCorrect) {
        state.wrong.push({
          ...question,
          user_choice: entry.choice?.text,
          correct_answer: question.answer,
          presented_choices: entry.prepared.map((c) => c.text),
        });
      }
    });
  });

  let groupCorrect = 0;
  groupState && Object.keys(groupState).forEach((key) => {
    const group = groupState[key];
    if (group.allCorrect && group.answered === group.total) {
      groupCorrect += 1;
      score += state.groupScores.get(key) || 0;
    }
  });

  const accuracy = answered ? (correct / answered) * 100 : 0;
  const summaryLines = [
    `Answered: ${answered}`,
    `Correct: ${correct}`,
    `Accuracy: ${accuracy.toFixed(1)}%`,
    `1-point correct: ${onePointCorrect}`,
    `2-point groups correct: ${groupCorrect} / ${state.groupTotals.size}`,
    `Score: ${score} / ${state.totalPossible} (${state.totalPossible ? ((score / state.totalPossible) * 100).toFixed(1) : "0.0"}%)`,
  ];
  elements.summaryText.innerHTML = summaryLines.join("<br />");

  elements.wrongList.innerHTML = "";
  if (state.wrong.length === 0) {
    const empty = document.createElement("div");
    empty.className = "wrong-card";
    empty.textContent = "No wrong answers. Great job!";
    elements.wrongList.appendChild(empty);
  } else {
    state.wrong.forEach((item, idx) => {
      const card = document.createElement("div");
      card.className = "wrong-card";

      const title = document.createElement("h3");
      title.textContent = `${idx + 1}. ${formatQuestionHeader(item)}`;
      card.appendChild(title);

      const questionLine = document.createElement("div");
      questionLine.className = "meta-line";
      questionLine.textContent = item.question || "";
      card.appendChild(questionLine);

      const answerLine = document.createElement("div");
      answerLine.className = "meta-line";
      answerLine.textContent = `Correct: ${item.answer}`;
      card.appendChild(answerLine);

      const userLine = document.createElement("div");
      userLine.className = "meta-line";
      userLine.textContent = `Your answer: ${item.user_choice || "(no answer)"}`;
      card.appendChild(userLine);

      const explanation = document.createElement("div");
      explanation.className = "explanation";
      explanation.textContent = item.answer_ko || "Explanation not available.";
      card.appendChild(explanation);

      elements.wrongList.appendChild(card);
    });
  }

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
  const shuffled = shuffleQuestionsBySection(state.source);
  state.sections = buildSections(shuffled);
  initGroupScoring(shuffled);
  renderCounts();
  setSummaryVisible(false);
  setQuizVisible(true);
  elements.resetBtn.disabled = false;
  renderPage();
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
  elements.prevBtn.addEventListener("click", goPrev);
  elements.nextBtn.addEventListener("click", goNext);
  elements.downloadBtn.addEventListener("click", downloadWrongQuestions);
}

document.addEventListener("DOMContentLoaded", () => {
  elements.startBtn = document.getElementById("start-btn");
  elements.resetBtn = document.getElementById("reset-btn");
  elements.prevBtn = document.getElementById("prev-btn");
  elements.nextBtn = document.getElementById("next-btn");
  elements.downloadBtn = document.getElementById("download-btn");
  elements.counts = document.getElementById("counts");
  elements.note = document.getElementById("note");
  elements.quiz = document.getElementById("quiz");
  elements.summary = document.getElementById("summary");
  elements.sectionProgress = document.getElementById("section-progress");
  elements.pageProgress = document.getElementById("page-progress");
  elements.header = document.getElementById("header");
  elements.questionGrid = document.getElementById("question-grid");
  elements.summaryText = document.getElementById("summary-text");
  elements.wrongList = document.getElementById("wrong-list");

  bindEvents();
  loadData();
});
