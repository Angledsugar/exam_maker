import argparse
import json
import os
import random
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

SECTION_ORDER = ["vocabulary", "grammar", "reading"]
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_QUESTION_PATH = os.path.join("question", "select_test.json")
DEFAULT_WRONG_OUT = os.path.join("review_note", "wrong_questions.json")


def resolve_path(path: str) -> str:
    if os.path.isabs(path):
        return path
    return os.path.join(BASE_DIR, path)


def load_json(path: str) -> List[Dict[str, Any]]:
    last_error: Optional[Exception] = None
    for enc in ("utf-8-sig", "utf-8", "cp949"):
        try:
            with open(path, "r", encoding=enc) as f:
                return json.load(f)
        except Exception as exc:  # pragma: no cover - best effort
            last_error = exc
    if last_error:
        raise last_error
    raise RuntimeError("Failed to load JSON.")


def normalize_section(section: Any) -> str:
    if section is None:
        return ""
    return str(section).strip().lower()


def group_questions(
    data: List[Dict[str, Any]], section_order: List[str]
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    selected: List[Dict[str, Any]] = []
    others: List[Dict[str, Any]] = []

    by_section: Dict[str, List[Dict[str, Any]]] = {s: [] for s in section_order}
    for q in data:
        sec = normalize_section(q.get("section"))
        if sec in by_section:
            by_section[sec].append(q)
        else:
            others.append(q)

    for sec in section_order:
        selected.extend(by_section[sec])

    return selected, others


def shuffle_choices(
    choices: List[str], answer: Optional[str], rng: random.Random
) -> Tuple[List[Tuple[str, bool]], bool]:
    prepared: List[Tuple[str, bool]] = []
    has_answer = False
    for choice in choices:
        is_correct = answer is not None and choice == answer
        if is_correct:
            has_answer = True
        prepared.append((choice, is_correct))

    rng.shuffle(prepared)
    return prepared, has_answer


def parse_answer(raw: str, option_count: int) -> Optional[int]:
    if not raw:
        return None
    raw = raw.strip().lower()
    if raw in {"q", "quit", "exit"}:
        return -1

    if raw.isdigit():
        idx = int(raw) - 1
        if 0 <= idx < option_count:
            return idx
        return None

    if len(raw) == 1 and "a" <= raw <= "z":
        idx = ord(raw) - ord("a")
        if 0 <= idx < option_count:
            return idx
        return None

    return None


def format_header(q: Dict[str, Any], index: int, total: int) -> str:
    section = normalize_section(q.get("section"))
    if section == "reading":
        unit = q.get("unit")
        qnum = q.get("question_num")
        page = q.get("page")
        label_parts = ["Reading"]
        if unit is not None:
            label_parts.append(f"Unit:{unit}")
        if qnum is not None:
            label_parts.append(f"Q:{qnum}")
        label = " ".join(label_parts)
        if page is not None:
            label = f"{label} (p.{page})"
        return f"[{index}/{total}] {label}".strip()

    section_raw = q.get("section") or ""
    unit = q.get("unit")
    qnum = q.get("question_num")
    parts = [f"[{index}/{total}]", str(section_raw).capitalize()]
    if unit is not None:
        parts.append(f"Unit:{unit}")
    if qnum is not None:
        parts.append(f"Q:{qnum}")
    return " ".join(p for p in parts if p)


def run_quiz(
    questions: List[Dict[str, Any]],
    rng: random.Random,
    show_answer: bool,
    show_explanation: bool,
    wrong_out_path: str,
) -> int:
    if not questions:
        print("No questions found.")
        return 1

    total_score = 0
    correct_count = 0
    answered_count = 0
    one_point_correct = 0
    missing_answers = 0
    wrong_questions: List[Dict[str, Any]] = []

    group_totals: Dict[Any, int] = {}
    group_scores: Dict[Any, int] = {}
    non_group_possible = 0
    non_group_count = 0
    for q in questions:
        group_id = q.get("special_list")
        score = q.get("score") or 1
        try:
            score_value = int(score)
        except (TypeError, ValueError):
            score_value = 1

        if group_id is not None:
            group_totals[group_id] = group_totals.get(group_id, 0) + 1
            if group_id not in group_scores:
                group_scores[group_id] = score_value
        else:
            non_group_possible += score_value
            non_group_count += 1

    total_possible = non_group_possible + sum(group_scores.values())
    group_state: Dict[Any, Dict[str, int | bool]] = {
        gid: {"all_correct": True, "answered": 0} for gid in group_totals
    }

    for idx, q in enumerate(questions, start=1):
        question_text = (q.get("question") or "").strip()
        choices = q.get("choice") or []
        answer = q.get("answer")
        group_id = q.get("special_list")
        score = q.get("score") or 1
        try:
            score_value = int(score)
        except (TypeError, ValueError):
            score_value = 1

        if not question_text or not choices:
            print(f"[{idx}/{len(questions)}] Skipping empty question.")
            if group_id is not None:
                group_state[group_id]["all_correct"] = False
            continue

        prepared, has_answer = shuffle_choices(choices, answer, rng)
        if not has_answer:
            missing_answers += 1
            if group_id is not None:
                group_state[group_id]["all_correct"] = False

        print()
        print(format_header(q, idx, len(questions)))
        print(question_text)
        for i, (choice_text, _) in enumerate(prepared):
            label = chr(ord("A") + i)
            print(f"  {label}. {choice_text}")

        while True:
            raw = input("Your answer (A-D / 1-4, Enter=skip, Q=quit): ")
            parsed = parse_answer(raw, len(prepared))
            if parsed is None:
                if raw.strip() == "":
                    print("Skipped.")
                    if group_id is not None:
                        group_state[group_id]["all_correct"] = False
                    break
                print("Invalid input. Try again.")
                continue
            if parsed == -1:
                print("Quiz ended early.")
                print()
                group_points, group_correct = finalize_group_result(
                    group_state, group_totals, group_scores
                )
                total_score += group_points
                print_summary(
                    correct_count,
                    answered_count,
                    total_score,
                    total_possible,
                    one_point_correct,
                    non_group_count,
                    group_correct,
                    len(group_totals),
                )
                if missing_answers:
                    print(f"Warning: {missing_answers} question(s) had no matching answer.")
                save_wrong_questions(wrong_questions, wrong_out_path)
                return 0

            answered_count += 1
            chosen_text, is_correct = prepared[parsed]
            if is_correct:
                correct_count += 1
                if group_id is None:
                    total_score += score_value
                    one_point_correct += 1
                print("Correct!")
            else:
                print("Incorrect.")
                wrong_entry = dict(q)
                wrong_entry["user_choice"] = chosen_text
                wrong_entry["correct_answer"] = answer
                wrong_entry["presented_choices"] = [c for c, _ in prepared]
                wrong_questions.append(wrong_entry)
                if group_id is not None:
                    group_state[group_id]["all_correct"] = False

            if group_id is not None:
                group_state[group_id]["answered"] += 1

            if show_answer:
                correct_texts = [c for c, ok in prepared if ok]
                if correct_texts:
                    print(f"Answer: {', '.join(correct_texts)}")
                else:
                    print("Answer: (missing in data)")
            if show_explanation:
                explanation = q.get("answer_ko")
                if explanation:
                    print(f"Explanation: {explanation}")
            break

    group_points, group_correct = finalize_group_result(
        group_state, group_totals, group_scores
    )
    total_score += group_points
    print()
    print_summary(
        correct_count,
        answered_count,
        total_score,
        total_possible,
        one_point_correct,
        non_group_count,
        group_correct,
        len(group_totals),
    )
    if missing_answers:
        print(f"Warning: {missing_answers} question(s) had no matching answer.")
    save_wrong_questions(wrong_questions, wrong_out_path)
    return 0


def print_summary(
    correct_count: int,
    answered_count: int,
    total_score: int,
    total_possible: int,
    one_point_correct: int,
    one_point_total: int,
    two_point_groups_correct: int,
    two_point_groups_total: int,
) -> None:
    if answered_count:
        accuracy = (correct_count / answered_count) * 100
    else:
        accuracy = 0.0
    if total_possible:
        score_pct = (total_score / total_possible) * 100
    else:
        score_pct = 0.0

    print(f"Answered: {answered_count}")
    print(f"Correct: {correct_count}")
    print(f"Accuracy: {accuracy:.1f}%")
    print(f"1-point correct: {one_point_correct}/{one_point_total}")
    print(f"2-point groups correct: {two_point_groups_correct}/{two_point_groups_total}")
    print(f"Score: {total_score}/{total_possible} ({score_pct:.1f}%)")


def finalize_group_result(
    group_state: Dict[Any, Dict[str, int | bool]],
    group_totals: Dict[Any, int],
    group_scores: Dict[Any, int],
) -> Tuple[int, int]:
    group_points = 0
    group_correct = 0
    for gid, total in group_totals.items():
        state = group_state.get(gid, {})
        all_correct = bool(state.get("all_correct"))
        answered = int(state.get("answered", 0))
        if all_correct and answered == total:
            group_points += int(group_scores.get(gid, 0))
            group_correct += 1
    return group_points, group_correct


def count_question_types(questions: List[Dict[str, Any]]) -> Tuple[int, int]:
    one_point_count = 0
    group_ids = set()
    for q in questions:
        group_id = q.get("special_list")
        if group_id is None:
            one_point_count += 1
        else:
            group_ids.add(group_id)
    return one_point_count, len(group_ids)


def shuffle_questions_by_section(
    questions: List[Dict[str, Any]], rng: random.Random
) -> List[Dict[str, Any]]:
    by_section: Dict[str, List[Dict[str, Any]]] = {s: [] for s in SECTION_ORDER}
    for q in questions:
        sec = normalize_section(q.get("section"))
        if sec in by_section:
            by_section[sec].append(q)

    shuffled: List[Dict[str, Any]] = []
    for sec in SECTION_ORDER:
        sec_items = by_section[sec]
        rng.shuffle(sec_items)
        shuffled.extend(sec_items)
    return shuffled


def find_latest_review_file(review_dir: str) -> Optional[str]:
    if not os.path.isdir(review_dir):
        return None
    candidates = []
    for name in os.listdir(review_dir):
        if not name.lower().endswith(".json"):
            continue
        if not name.startswith("wrong_questions"):
            continue
        path = os.path.join(review_dir, name)
        if os.path.isfile(path):
            candidates.append(path)
    if not candidates:
        return None
    return max(candidates, key=os.path.getmtime)


def save_wrong_questions(wrong_questions: List[Dict[str, Any]], output_path: str) -> None:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base_path = output_path
    if not os.path.isabs(base_path):
        base_path = os.path.join(BASE_DIR, base_path)

    os.makedirs(os.path.dirname(base_path), exist_ok=True)

    root, ext = os.path.splitext(base_path)
    if ext:
        output_path = f"{root}_{timestamp}{ext}"
    else:
        output_path = f"{base_path}_{timestamp}.json"

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(wrong_questions, f, ensure_ascii=False, indent=2)
    print(f"Saved wrong questions: {len(wrong_questions)} -> {output_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="English test quiz runner.")
    parser.add_argument("--file", default=DEFAULT_QUESTION_PATH, help="Question JSON file path.")
    parser.add_argument("--seed", type=int, default=None, help="Random seed for shuffling choices.")
    parser.add_argument("--show-answer", action="store_true", help="Show correct answer after each question.")
    parser.add_argument(
        "--show-explanation",
        action="store_true",
        help="Show answer_ko (if present) after each question.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit questions per section (applied in vocabulary/grammar/reading order).",
    )
    parser.add_argument(
        "--wrong-out",
        default=DEFAULT_WRONG_OUT,
        help="Output JSON path for wrong questions.",
    )
    parser.add_argument(
        "--no-shuffle",
        action="store_true",
        help="Disable question shuffle (default: shuffle within each section).",
    )
    parser.add_argument(
        "--review-file",
        default=None,
        help="Use questions from a review_note JSON file instead of the main question file.",
    )
    parser.add_argument(
        "--review-latest",
        action="store_true",
        help="Use the most recent review_note JSON file.",
    )

    args = parser.parse_args()

    path = args.file
    if args.review_file:
        path = args.review_file
    elif args.review_latest:
        path = find_latest_review_file(os.path.join(BASE_DIR, "review_note"))
        if path is None:
            print("No review_note JSON files found.", file=sys.stderr)
            return 1

    path = resolve_path(path)
    if not os.path.exists(path):
        print(f"File not found: {path}", file=sys.stderr)
        return 1

    data = load_json(path)
    if not isinstance(data, list):
        print("Invalid JSON: expected a list of questions.", file=sys.stderr)
        return 1

    selected, others = group_questions(data, SECTION_ORDER)
    if args.limit is not None:
        limited: List[Dict[str, Any]] = []
        for sec in SECTION_ORDER:
            sec_items = [q for q in selected if normalize_section(q.get("section")) == sec]
            limited.extend(sec_items[: max(args.limit, 0)])
        selected = limited

    if others:
        print(f"Note: {len(others)} question(s) had unknown sections and were skipped.")

    rng = random.Random(args.seed)
    if not args.no_shuffle:
        selected = shuffle_questions_by_section(selected, rng)

    one_point_count, two_point_group_count = count_question_types(selected)
    print(f"1-point questions: {one_point_count}")
    print(f"2-point groups (special_list): {two_point_group_count}")

    return run_quiz(selected, rng, args.show_answer, args.show_explanation, args.wrong_out)


if __name__ == "__main__":
    raise SystemExit(main())
