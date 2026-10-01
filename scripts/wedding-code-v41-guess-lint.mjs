#!/usr/bin/env node
/**
 * 웨딩코드 4.1 단계 2 「서로 짐작하기」 세트 검사기 명령줄(라이브러리: scripts/lib/wedding-code-v41-guess-lint.mjs).
 *
 *   node scripts/wedding-code-v41-guess-lint.mjs [세트.json] [--vocab 목록.json]
 *       세트를 검사한다. 위반이 있으면 종료 코드 1. 세트 옆의 승인한 어휘 목록(세트 이름.vocab.json)이 없으면 그것도 위반이다.
 *   node scripts/wedding-code-v41-guess-lint.mjs --new-words [세트.json]
 *       승인한 어휘에 없는 낱말을 그 낱말이 든 문장째 출력한다(두 번째 읽는 사람이 보는 표).
 *   node scripts/wedding-code-v41-guess-lint.mjs --freeze [세트.json]
 *       낱말 규칙에 위반이 없을 때만 지금 화면 글의 낱말을 승인한 어휘 목록에 얼린다.
 *   node scripts/wedding-code-v41-guess-lint.mjs --candidate [세트.json]
 *       같은 계산을 하되 후보 목록(세트 이름.vocab.candidate.json)에만 쓴다. 얼리지 않는다.
 *   node scripts/wedding-code-v41-guess-lint.mjs --selftest [세트.json] [--vocab 목록.json] [--write-planted 경로.json]
 *       음성 대조. 원본 사본에 위반을 하나씩 심어 각각 기대한 규칙이 나오는지, 위반 여덟 개를 한 사본에 함께 심어 모두 잡히는지,
 *       화면 글자열마다 규칙 가족별 프로브를 붙여 잡히는지, 깨끗한 대조가 오탐 없는지, 어휘 목록 파일이 없으면 위반인지를 센다.
 *       어휘 문은 --vocab 이 없으면 지금 원본에서 만든 후보 목록으로 켠다(이 시험은 규칙을 재는 것이지 얼린 상태를 재는 것이 아니다).
 *   node scripts/wedding-code-v41-guess-lint.mjs --limits     한도표만 출력한다.
 *
 * **얼리기 전의 종료 코드는 1 이다(의도한 것이다).** 승인한 어휘 목록은 새 낱말을 **글을 고친 사람이 아닌 사람**이 문장째 읽고 평가어, 성향어,
 * 강한 정도말, 원인어, 예식어, 전제어, 지칭어, 수량말이 아님을 확인한 뒤에만 --freeze 로 갱신한다. 이 저장소의 어떤 코드도 목록을 대신 얼리지 않는다.
 * 지금 저장소의 목록은 앞선 판에서 사람이 읽고 승인한 낱말뿐이라 4.1 단계 2 에서 고친 문구의 새 낱말이 new-word 로 남는다.
 * vitest 시험은 이 상태를 경고로 보고만 하고 빨갛게 만들지 않는다. 사람이 읽은 뒤 --freeze 를 돌려 목록을 커밋하면 이 명령이 종료 코드 0 이 된다.
 */
import fs from "node:fs";
import os from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANDIDATE_SUFFIX,
  collectTexts,
  freezeVocab,
  lintFile,
  lintGuessSet,
  limitsTable,
  report,
  runSelfTest,
  stripParticle,
  vocabPathFor,
  wordsOf,
} from "./lib/wedding-code-v41-guess-lint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_SET_PATH = join(ROOT, "docs", "wedding-code", "2026-10-01_v41_guess_set.json");

const argVal = (args, name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

function readVocab(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8")).tokens;
  } catch {
    return null;
  }
}

function writeVocab(file, outName, d, note) {
  const tokens = freezeVocab(d);
  const out = outName === "freeze" ? vocabPathFor(file) : vocabPathFor(file, CANDIDATE_SUFFIX);
  fs.writeFileSync(out, `${JSON.stringify({ schema: "wedding-code-guess-vocab/1", source: basename(file), note, tokens }, null, 2)}\n`);
  console.log(`어휘 목록 ${tokens.length}개를 ${out} 에 썼다`);
}

function main(args) {
  const vocabOpt = argVal(args, "--vocab");
  const plantedOut = argVal(args, "--write-planted");
  const positional = args.filter((a, i) => !a.startsWith("--") && !["--vocab", "--write-planted"].includes(args[i - 1]));
  const file = resolve(positional[0] ?? DEFAULT_SET_PATH);

  if (args.includes("--limits")) {
    console.log(limitsTable());
    return 0;
  }

  if (args.includes("--new-words")) {
    const d = JSON.parse(fs.readFileSync(file, "utf8"));
    const ok = new Set(readVocab(vocabOpt ?? vocabPathFor(file)) ?? []);
    const byWord = new Map();
    for (const { path, text } of collectTexts(d)) {
      for (const w of wordsOf(text)) {
        if (ok.has(w) || ok.has(stripParticle(w))) continue;
        if (!byWord.has(w)) byWord.set(w, { paths: new Set(), sample: text });
        byWord.get(w).paths.add(path);
      }
    }
    console.log(`승인한 어휘에 없는 낱말 ${byWord.size}개(두 번째 읽는 사람이 문장째 보고 평가어, 성향어, 정도말, 원인어, 예식어, 전제어, 지칭어, 수량말인지 표시한다)`);
    for (const [w, v] of [...byWord.entries()].sort((a, b) => a[0].localeCompare(b[0], "ko"))) console.log(`- ${w} | ${[...v.paths][0]} | ${v.sample}`);
    return 0;
  }

  if (args.includes("--freeze") || args.includes("--candidate")) {
    const d = JSON.parse(fs.readFileSync(file, "utf8"));
    const V = lintGuessSet(d);
    if (V.length) {
      report(V);
      console.log(`낱말 규칙 위반 ${V.length}개가 있어 어휘 목록을 만들지 않는다`);
      return 1;
    }
    if (args.includes("--candidate")) {
      writeVocab(file, "candidate", d, "후보 목록이다. 얼리지 않았다(글을 고친 사람이 만들었다). 글을 고친 사람이 아닌 사람이 새 낱말을 문장째 읽고 평가어, 성향어, 강한 정도말, 원인어, 예식어, 전제어, 지칭어, 수량말이 아님을 확인한 뒤에만 --freeze 로 승인한 목록을 갱신한다.");
    } else {
      writeVocab(file, "freeze", d, "사람이 읽고 승인한 낱말 목록이다. 이 목록에 없는 낱말이 화면 글에 들어오면 검사기가 new-word 로 막는다. 목록을 갱신하기 전에 새 낱말이 평가어, 성향어, 강한 정도말, 원인어, 예식어, 전제어가 아닌지 읽는다.");
    }
    return 0;
  }

  if (args.includes("--selftest")) {
    const base = JSON.parse(fs.readFileSync(file, "utf8"));
    const given = vocabOpt ? readVocab(vocabOpt) : null;
    if (vocabOpt && !given) {
      console.log(`어휘 목록(${vocabOpt})을 읽지 못했다`);
      return 1;
    }
    const vocab = given ?? freezeVocab(base);
    const gate = { vocab };
    const res = runSelfTest(base, gate);
    console.log(`원본 사본 위반 ${res.clean.length}(0이어야 한다) | 어휘 목록: ${vocabOpt ?? "지금 원본에서 만든 후보(얼린 목록이 아님)"}`);
    report(res.clean);
    res.mutations.forEach((m, i) => {
      console.log(`${m.ok ? "잡음" : "놓침"} | ${String(i + 1).padStart(2)} ${m.name} | 기대 ${m.rule} | 나온 규칙 ${m.got.join(",") || "없음"}`);
    });
    const caught = res.mutations.filter((m) => m.ok).length;
    console.log(`개별 음성 대조: 심은 위반 ${res.mutations.length}개 중 ${caught}개 잡음`);
    for (const b of res.blind) {
      console.log(`${b.stillBlind ? "못 잡음(알려진 한계)" : "이제 잡음(한계 문단을 고칠 것)"} | ${b.name} | 나온 규칙 ${b.got.join(",") || "없음"}`);
    }
    const blindStill = res.blind.filter((b) => b.stillBlind).length;
    console.log(`알려진 한계 ${res.blind.length}개 중 ${blindStill}개는 여전히 못 잡는다(사람 짝 맞추기와 사람 읽기가 맡는다)`);
    console.log(`한 사본에 함께 심은 위반 ${res.planted.rules.length}개(${res.planted.rules.join(",")}) 중 ${res.planted.caught.length}개 잡음`);
    if (plantedOut) {
      fs.writeFileSync(plantedOut, `${JSON.stringify(res.planted.doc, null, 2)}\n`);
      console.log(`심은 사본을 ${plantedOut} 에 썼다`);
    }
    console.log(`덮개 시험(낱말 규칙만, 어휘 문 끔): 화면에 나가는 글자열 ${res.probes.leaves}개 x 규칙 가족별 프로브 = ${res.probes.total}번 중 ${res.probes.total - res.probes.missed.length}번 잡힘${res.probes.missed.length ? ` | 놓친 곳: ${res.probes.missed.slice(0, 20).join(", ")}` : ""}`);
    for (const f of res.falsePositives) {
      console.log(`오탐 | ${f.kind} | ${f.text}`);
      report(f.hits);
    }
    console.log(`깨끗한 대조 오탐 ${res.falsePositives.length}개`);
    const tmp = fs.mkdtempSync(join(os.tmpdir(), "guessset-"));
    fs.writeFileSync(join(tmp, "sample.json"), JSON.stringify(base));
    const noVocab = lintFile(join(tmp, "sample.json")).V.some((v) => v.rule === "vocab-missing");
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`어휘 목록 파일이 없으면 vocab-missing 위반: ${noVocab ? "예" : "아니오"}`);
    const okAll =
      res.clean.length === 0 &&
      caught === res.mutations.length &&
      res.planted.caught.length === res.planted.rules.length &&
      res.planted.rules.length === 8 &&
      res.probes.missed.length === 0 &&
      res.falsePositives.length === 0 &&
      noVocab &&
      blindStill === res.blind.length;
    console.log(okAll ? "회귀 방지 음성 대조 통과(목록 밖 낱말을 얼마나 잡는지는 라이브러리 머리말의 측정을 볼 것)" : "음성 대조 실패");
    return okAll ? 0 : 1;
  }

  const { d, V, vocab } = lintFile(file, vocabOpt);
  console.log(limitsTable());
  report(V);
  console.log(`장면 ${Array.isArray(d.items) ? d.items.length : 0}개, 어휘 문 ${vocab ? `켬(승인 낱말 ${vocab.length}개${vocabOpt ? `, 목록 ${vocabOpt}` : ""})` : "꺼짐"}, 위반 ${V.length}`);
  if (V.length > 0 && V.every((v) => v.rule === "new-word")) {
    console.log("위반이 모두 new-word 다: 어휘 목록이 아직 새 낱말을 얼리지 않았다. 종료 코드 1 은 의도한 것이다.");
    console.log("글을 고친 사람이 아닌 사람이 --new-words 표를 문장째 읽고 괜찮을 때만 --freeze 를 돌려 목록을 커밋한다. 이 저장소의 코드는 목록을 대신 얼리지 않는다.");
  }
  return V.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  // process.exit() 은 아직 비우지 못한 표준 출력을 잘라 낸다(리눅스에서 파이프로 받으면 64킬로바이트쯤에서 끊겼다: CI 에서 마지막 줄이 사라졌다).
  // 종료 코드만 정해 두고 프로세스가 스스로 끝나게 한다.
  process.exitCode = main(process.argv.slice(2));
}
