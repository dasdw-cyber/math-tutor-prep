"use strict";
// 本文件只产生程序测试夹具，不是教学质量或真题获取测试。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const skillRoot = process.argv[2];
if (!skillRoot) throw new Error("请提供待测试Skill目录。");
const rendererPath = path.join(skillRoot, "scripts", "render_materials.cjs");
const { validatePlan, validateLesson, buildMaterials } = require(rendererPath);
const deps = path.resolve(path.dirname(process.execPath), "..", "node_modules");
const JSZip = require(path.join(deps, "jszip"));
const runRoot = fs.mkdtempSync(path.join(__dirname, "run-"));
const dataRoot = path.join(runRoot, "data");
fs.mkdirSync(dataRoot);
const clone = (value) => JSON.parse(JSON.stringify(value));
const writeData = (name, value) => fs.writeFileSync(path.join(dataRoot, name), JSON.stringify(value, null, 2));
const math = (value) => ({ math: value });
let passed = 0;
const pass = () => { passed++; };

const plan = {
    student_stage: "初中程序测试", scope: "生成器测试夹具，不是教学材料", lesson_count: 1, duration_minutes: 60, confirmed: true,
    lessons: [{ number: 1, title: "结构与公式测试", goals: ["检查生成器的输入输出"], focus: ["不把测试数据作为真实教学成果"],
        activities: [{ name: "检查输入", content: "核对结构", minutes: 20 }, { name: "检查输出", content: "核对Word", minutes: 40 }] }],
};
const exercises = [];
const levels = ["基础", "中档", "拔尖"];
const types = ["单选", "填空", "多选", "解答"];
for (const level of levels) types.forEach((type, index) => {
    for (let offset = 0; offset < [5, 4, 3, 3][index]; offset++) {
        const n = exercises.length + 1;
        const question = { id: `g${n}`, level, type,
            stem: [[`程序测试条目${n}：`, math(["x+", String(n), "=", String(n * 2)]), "。此数据不用于教学。"]],
            source: { kind: "generated" },
            solution: { idea: [["移项。"]], steps: [[math(["x=", String(n * 2), "−", String(n)])]], answer: [[math(["x=", String(n)])]] },
        };
        if (type === "单选" || type === "多选") {
            question.options = [[String(n)], [String(n + 1)], [String(n + 2)], [String(n + 3)]];
            question.compact_options = true;
            question.solution.answer = [["程序夹具选择A；只验证结构，不评价题型质量。"]];
        }
        exercises.push(question);
    }
});
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBz0AAAAASUVORK5CYII=", "base64");
fs.writeFileSync(path.join(dataRoot, "figure.png"), png);
fs.writeFileSync(path.join(runRoot, "outside.png"), png);
const lesson = {
    plan_file: "confirmed-plan.json", number: 1,
    knowledge: [{ title: "公式结构测试", paragraphs: [
        ["以下只验证公式节点，不是数学课程内容。"],
        [math(["x=", { frac: [["−b±", { sqrt: [{ sup: ["b", "2"] }, "−4ac"] }], "2a"] }])],
        [math([{ sub: ["a", "n"] }, "+", { root: { body: "8", degree: "3" } }])],
        [math([{ sum: { body: [{ sub: ["a", "i"] }], lower: "i=1", upper: "n" } }])],
        [math([{ integral: { body: ["x dx"], lower: "0", upper: "1" } }])],
        [{ image: "figure.png", role: "figure", width: 24, height: 24, alt: "程序图形夹具" }],
    ], examples: [{ stem: [["仅供结构测试：", math(["x+1=2"])]], solution: { idea: [["移项。"]], steps: [[math(["x=2−1"])]], answer: [[math(["x=1"])]] } }] }],
    exercises,
    coverage: [{ point: "测试知识点", pattern: "测试结构", method: "移项测试", question_ids: exercises.map((question) => question.id) }],
    references: [], reference_note: "测试夹具未检索参考资料，不作来源或质量验证。",
};
writeData("confirmed-plan.json", plan);
writeData("lesson.json", lesson);

async function main() {
    validatePlan(plan); pass();
    validateLesson(lesson, plan); pass();
    const badPlan = clone(plan); badPlan.confirmed = false;
    assert.throws(() => validatePlan(badPlan), /尚未确认/); pass();
    const badTime = clone(plan); badTime.lessons[0].activities[0].minutes = 19;
    assert.throws(() => validatePlan(badTime), /用时/); pass();
    const noStage = clone(plan); noStage.student_stage = "";
    assert.throws(() => validatePlan(noStage), /年段/); pass();
    const otherLesson = clone(lesson); otherLesson.number = 2;
    assert.throws(() => validateLesson(otherLesson, plan), /不在已确认/); pass();
    const short = clone(lesson); short.exercises.pop();
    assert.throws(() => validateLesson(short, plan), /题量不符/); pass();
    const duplicate = clone(lesson); duplicate.exercises[1].id = duplicate.exercises[0].id;
    assert.throws(() => validateLesson(duplicate, plan), /重复题目ID/); pass();
    const duplicateStem = clone(lesson); duplicateStem.exercises[1].stem = duplicateStem.exercises[0].stem; duplicateStem.exercises[1].options = duplicateStem.exercises[0].options;
    assert.throws(() => validateLesson(duplicateStem, plan), /完全相同/); pass();
    const noAnswer = clone(lesson); noAnswer.exercises[0].solution.answer = [];
    assert.throws(() => validateLesson(noAnswer, plan), /解析answer/); pass();
    const noChoice = clone(lesson); delete noChoice.exercises[0].options;
    assert.throws(() => validateLesson(noChoice, plan), /缺少选项/); pass();
    const noCoverage = clone(lesson); noCoverage.coverage[0].question_ids.pop();
    assert.throws(() => validateLesson(noCoverage, plan), /未加入内部映射/); pass();
    const unknownCoverage = clone(lesson); unknownCoverage.coverage[0].question_ids.push("unknown");
    assert.throws(() => validateLesson(unknownCoverage, plan), /引用未知/); pass();

    // 来源字段测试只在内存里进行，example.com记录不是真题来源。
    const originalCase = clone(lesson);
    const original = clone(lesson.exercises[0]);
    original.id = "source-fixture"; original.level = "真题"; original.stem = [["仅供来源格式检查的内存测试条目，不是真题。"]];
    original.source = { kind: "original", title: "程序测试记录，不是真实考试", url: "https://example.com/fixture", locator: "测试位置" };
    originalCase.exercises.push(original);
    validateLesson(originalCase, plan); pass();
    const noSource = clone(originalCase); delete noSource.exercises.at(-1).source.url;
    assert.throws(() => validateLesson(noSource, plan), /实际HTTP/); pass();
    const fakeOriginal = clone(originalCase); fakeOriginal.exercises.at(-1).source.kind = "generated";
    assert.throws(() => validateLesson(fakeOriginal, plan), /不得用生成题替代/); pass();
    const tooMany = clone(originalCase);
    for (let index = 0; index < 4; index++) tooMany.exercises.push({ ...clone(original), id: `extra-${index}`, stem: [[`内存配额测试${index}`]] });
    assert.throws(() => validateLesson(tooMany, plan), /最多4/); pass();

    const planFiles = await buildMaterials("plan", plan, dataRoot);
    const lessonFiles = await buildMaterials("lesson", lesson, dataRoot);
    assert.equal(planFiles.length, 1); assert.equal(lessonFiles.length, 3); pass();
    const xmls = {};
    for (const file of [...planFiles, ...lessonFiles]) {
        const zip = await JSZip.loadAsync(file.buffer);
        const xml = await zip.file("word/document.xml").async("string");
        assert(xml.includes('w:w="11906"') && xml.includes('w:h="16838"'));
        xmls[file.filename] = xml;
    }
    const exerciseXml = xmls["第01课_练习题.docx"], answerXml = xmls["第01课_答案解析.docx"];
    assert(exerciseXml.includes("真题未满足标准10题") && exerciseXml.includes("单选4题、填空3题、多选2题、解答1题")); pass();
    assert.equal((exerciseXml.match(/程序测试条目/g) || []).length, 45);
    assert.equal((answerXml.match(/程序测试条目/g) || []).length, 45); pass();
    const blocks = (xml) => [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((match) => match[0]).filter((block) =>
        /<w:t[^>]*>\d+\. <\/w:t>/.test(block) || /<w:t[^>]*>[A-D]\. <\/w:t>/.test(block));
    assert.deepEqual(blocks(exerciseXml), blocks(answerXml)); pass();
    const knowledgeXml = xmls["第01课_知识点资料.docx"];
    for (const tag of ["oMath", "f", "rad", "sSup", "sSub", "nary"]) assert(knowledgeXml.includes(`<m:${tag}`));
    const imageZip = await JSZip.loadAsync(lessonFiles[0].buffer);
    assert(Object.keys(imageZip.files).some((name) => name.startsWith("word/media/"))); pass();
    const sourceFiles = await buildMaterials("lesson", originalCase, dataRoot);
    const sourceZip = await JSZip.loadAsync(sourceFiles[2].buffer);
    assert((await sourceZip.file("word/document.xml").async("string")).includes("不是官方解析"));
    assert((await sourceZip.file("word/_rels/document.xml.rels").async("string")).includes("https://example.com/fixture")); pass();

    const spaced = clone(lesson); spaced.knowledge[0].paragraphs.push(["文字与公式", " ", math(["x=1"])]);
    assert.equal((await buildMaterials("lesson", spaced, dataRoot)).length, 3); pass();

    const unsupported = clone(lesson); unsupported.knowledge[0].paragraphs = [[math([{ cases: ["unsupported"] }])]];
    await assert.rejects(() => buildMaterials("lesson", unsupported, dataRoot), /暂不支持公式结构/); pass();
    const emptyMath = clone(lesson); emptyMath.knowledge[0].paragraphs = [[math([])]];
    await assert.rejects(() => buildMaterials("lesson", emptyMath, dataRoot), /公式内容/); pass();
    const latex = clone(lesson); latex.knowledge[0].paragraphs = [[math(["\\frac{1}{2}"])]];
    await assert.rejects(() => buildMaterials("lesson", latex, dataRoot), /未转换的LaTeX/); pass();
    const escape = clone(lesson); escape.knowledge[0].paragraphs = [[{ image: "../outside.png", role: "figure", width: 24, height: 24, alt: "不应读到" }]];
    await assert.rejects(() => buildMaterials("lesson", escape, dataRoot), /越过数据目录/); pass();
    const absolutePlan = clone(lesson); absolutePlan.plan_file = path.join(dataRoot, "confirmed-plan.json");
    await assert.rejects(() => buildMaterials("lesson", absolutePlan, dataRoot), /相对文件路径/); pass();

    const outputRoot = path.join(runRoot, "word-output");
    const cli = (mode, input) => spawnSync(process.execPath, [rendererPath, mode, path.join(dataRoot, input), "--out", outputRoot], { encoding: "utf8" });
    assert.equal(cli("plan", "confirmed-plan.json").status, 0);
    assert.equal(cli("lesson", "lesson.json").status, 0); pass();
    const planPath = path.join(outputRoot, "课程计划.docx");
    const oldHash = crypto.createHash("sha256").update(fs.readFileSync(planPath)).digest("hex");
    const overwrite = cli("plan", "confirmed-plan.json");
    assert.notEqual(overwrite.status, 0); assert(overwrite.stderr.includes("目标已存在"));
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(planPath)).digest("hex"), oldHash); pass();
    const invalidInput = clone(lesson); invalidInput.exercises.pop(); writeData("invalid.json", invalidInput);
    const invalidOutput = path.join(runRoot, "should-not-exist");
    const rejected = spawnSync(process.execPath, [rendererPath, "lesson", path.join(dataRoot, "invalid.json"), "--out", invalidOutput], { encoding: "utf8" });
    assert.notEqual(rejected.status, 0); assert(!fs.existsSync(invalidOutput)); pass();

    console.log(JSON.stringify({ passedChecks: passed, testKind: "程序结构与生成测试，非真实教学或真题测试", files: fs.readdirSync(outputRoot), runRoot, outputRoot }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
