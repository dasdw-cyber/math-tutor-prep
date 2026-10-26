"use strict";

const fs = require("node:fs");
const path = require("node:path");

const LEVELS = ["基础", "中档", "拔尖", "真题"];
const TYPES = ["单选", "填空", "多选", "解答"];
const GENERATED_QUOTA = [5, 4, 3, 3];
const ORIGINAL_QUOTA = [4, 3, 2, 1];
const TYPE_LABELS = ["单项选择题", "填空题", "多项选择题", "解答题"];
const MATH_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const FONT = { ascii: "Times New Roman", hAnsi: "Times New Roman", eastAsia: "宋体", cs: "Times New Roman" };
const HEADING_FONT = { ...FONT, eastAsia: "黑体" };

function check(condition, message) {
    if (!condition) throw new Error(message);
}
function text(value, name) {
    check(typeof value === "string" && value.trim().length > 0 && !/[\r\n]/.test(value), `${name}须为非空单行文字。`);
    return value;
}
function positiveInteger(value, name) {
    check(Number.isSafeInteger(value) && value > 0, `${name}须为正整数。`);
}
function nonemptyArray(value, name) {
    check(Array.isArray(value) && value.length > 0, `${name}不能为空。`);
}
function validateLines(lines, name) {
    nonemptyArray(lines, name);
    lines.forEach((line) => nonemptyArray(line, `${name}中的段落`));
}
function validateSource(source, name) {
    check(source && typeof source === "object", `${name}来源缺失。`);
    text(source.title, `${name}来源标题`);
    text(source.locator, `${name}来源位置`);
    check(typeof source.url === "string" && /^https?:\/\//.test(source.url), `${name}需要实际HTTP或HTTPS来源链接。`);
}
function validateQuestion(question, name, exercise = false) {
    check(question && typeof question === "object", `${name}无效。`);
    validateLines(question.stem, `${name}题干`);
    if (question.options !== undefined) {
        check(Array.isArray(question.options) && question.options.length >= 2, `${name}选项不足。`);
        question.options.forEach((option) => nonemptyArray(option, `${name}选项`));
    }
    check(question.solution && typeof question.solution === "object", `${name}缺少解析。`);
    for (const key of ["idea", "steps", "answer"]) validateLines(question.solution[key], `${name}解析${key}`);
    if (!exercise) return;
    text(question.id, `${name}ID`);
    check(LEVELS.includes(question.level) && TYPES.includes(question.type), `${name}分区或题型无效。`);
    const isChoice = question.type === "单选" || question.type === "多选";
    check(!isChoice || Array.isArray(question.options), `${name}选择题缺少选项。`);
    check(isChoice || question.options === undefined, `${name}非选择题不能附选择题选项。`);
    if (question.level === "真题") {
        check(question.source?.kind === "original", `${name}真题不得用生成题替代。`);
        validateSource(question.source, name);
    } else {
        check(question.source?.kind === "generated", `${name}前三档必须标为生成题。`);
    }
}

function validatePlan(plan) {
    check(plan && typeof plan === "object", "计划数据无效。");
    text(plan.student_stage, "学生年段");
    text(plan.scope, "授课范围");
    positiveInteger(plan.lesson_count, "课次数");
    positiveInteger(plan.duration_minutes, "每次时长");
    check(plan.confirmed === true, "课程计划尚未确认，不能导出或生成单课材料。");
    check(Array.isArray(plan.lessons) && plan.lessons.length === plan.lesson_count, "计划课次总数不一致。");
    plan.lessons.forEach((lesson, index) => {
        check(lesson.number === index + 1, "计划课次应从1连续排列。");
        text(lesson.title, "课题");
        for (const key of ["goals", "focus"]) {
            nonemptyArray(lesson[key], key);
            lesson[key].forEach((entry) => text(entry, key));
        }
        nonemptyArray(lesson.activities, "教学环节");
        lesson.activities.forEach((activity) => {
            text(activity.name, "环节名称");
            text(activity.content, "环节内容");
            positiveInteger(activity.minutes, "环节分钟数");
        });
        check(lesson.activities.reduce((sum, activity) => sum + activity.minutes, 0) === plan.duration_minutes,
            `第${lesson.number}课各环节用时与单次时长不一致。`);
    });
}

function validateLesson(data, plan) {
    validatePlan(plan);
    positiveInteger(data.number, "所选课次");
    check(plan.lessons.some((lesson) => lesson.number === data.number), "所选课次不在已确认计划中。");
    nonemptyArray(data.knowledge, "知识点资料");
    let examples = 0;
    data.knowledge.forEach((section) => {
        text(section.title, "知识点标题");
        validateLines(section.paragraphs, "知识点正文");
        check(Array.isArray(section.examples), "知识点examples应为数组。");
        section.examples.forEach((example) => validateQuestion(example, `例题${++examples}`));
    });
    check(examples > 0, "知识点资料至少需要一个典型例题及解析。");
    nonemptyArray(data.exercises, "练习题");
    const ids = new Set();
    const stems = new Set();
    data.exercises.forEach((question) => {
        validateQuestion(question, `题目${question.id || "未命名"}`, true);
        check(!ids.has(question.id), `重复题目ID：${question.id}`);
        ids.add(question.id);
        const signature = JSON.stringify([question.stem, question.options || []]);
        check(!stems.has(signature), `发现完全相同的题干及选项：${question.id}`);
        stems.add(signature);
    });
    for (const level of LEVELS) {
        TYPES.forEach((type, index) => {
            const actual = data.exercises.filter((question) => question.level === level && question.type === type).length;
            const expected = level === "真题" ? ORIGINAL_QUOTA[index] : GENERATED_QUOTA[index];
            check(level === "真题" ? actual <= expected : actual === expected,
                `${level}${type}题量不符：实际${actual}，${level === "真题" ? "最多" : "要求"}${expected}。`);
        });
    }
    nonemptyArray(data.coverage, "内部覆盖映射");
    const covered = new Set();
    data.coverage.forEach((entry) => {
        ["point", "pattern", "method"].forEach((key) => text(entry[key], `映射${key}`));
        nonemptyArray(entry.question_ids, "映射题目ID");
        entry.question_ids.forEach((id) => { check(ids.has(id), `覆盖映射引用未知题目：${id}`); covered.add(id); });
    });
    data.exercises.filter((question) => question.level !== "真题").forEach((question) => check(covered.has(question.id), `生成题未加入内部映射：${question.id}`));
    check(Array.isArray(data.references), "references应为实际参考资料数组，未读取资料不可虚填。");
    data.references.forEach((source) => validateSource(source, "参考资料"));
    if (data.reference_note !== undefined) text(data.reference_note, "参考资料说明");
}

function localFile(relative, baseDirectory) {
    text(relative, "相对文件路径");
    check(!path.isAbsolute(relative), "仅允许数据目录内的相对文件路径。");
    const root = fs.realpathSync(baseDirectory);
    const resolved = fs.realpathSync(path.resolve(root, relative));
    const remaining = path.relative(root, resolved);
    check(remaining !== ".." && !remaining.startsWith(`..${path.sep}`) && !path.isAbsolute(remaining), "文件路径越过数据目录。");
    return resolved;
}

function dependencies(dependencyDirectory) {
    const root = dependencyDirectory ? path.resolve(dependencyDirectory) : path.resolve(path.dirname(process.execPath), "..", "node_modules");
    try { return { docx: require(path.join(root, "docx")), JSZip: require(path.join(root, "jszip")) }; }
    catch (error) { throw new Error(`无法加载docx与jszip，请由运行环境提供依赖目录，不要擅自全局安装。${error.message}`); }
}

async function buildMaterials(mode, data, baseDirectory, dependencyDirectory) {
    check(mode === "plan" || mode === "lesson", "模式只能为plan或lesson。");
    const plan = mode === "plan" ? data : JSON.parse(fs.readFileSync(localFile(data.plan_file, baseDirectory), "utf8"));
    if (mode === "plan") validatePlan(plan); else validateLesson(data, plan);
    const { docx: d, JSZip } = dependencies(dependencyDirectory);
    const p = (children, options = {}) => new d.Paragraph({ children, ...options });
    const t = (value, options = {}) => {
        check(typeof value === "string" && value.length > 0 && !/[\r\n]/.test(value), "文字应为单行字符串。");
        return new d.TextRun({ text: value, ...options });
    };
    const h1 = (value) => p([t(value)], { heading: d.HeadingLevel.HEADING_1 });
    const h2 = (value) => p([t(value)], { heading: d.HeadingLevel.HEADING_2 });

    function math(value) {
        const nodes = [].concat(value);
        nonemptyArray(nodes, "公式内容");
        return nodes.map((node) => {
            if (typeof node === "string") {
                text(node, "公式文字");
                check(!/\\[A-Za-z]+/.test(node), "公式中含未转换的LaTeX命令。");
                return new d.MathRun(node);
            }
            check(node && typeof node === "object" && !Array.isArray(node), "公式节点无效。");
            const keys = Object.keys(node);
            check(keys.length === 1, "公式节点应只包含一个结构键。");
            const key = keys[0], content = node[key];
            if (["sup", "sub", "frac"].includes(key)) {
                check(Array.isArray(content) && content.length === 2, `${key}需要两个部分。`);
                const first = math(content[0]), second = math(content[1]);
                if (key === "sup") return new d.MathSuperScript({ children: first, superScript: second });
                if (key === "sub") return new d.MathSubScript({ children: first, subScript: second });
                return new d.MathFraction({ numerator: first, denominator: second });
            }
            if (key === "sqrt") return new d.MathRadical({ children: math(content) });
            if (key === "root") return new d.MathRadical({ children: math(content.body), degree: math(content.degree) });
            if (key === "sum" || key === "integral") {
                const options = { children: math(content.body) };
                if (content.lower !== undefined) options.subScript = math(content.lower);
                if (content.upper !== undefined) options.superScript = math(content.upper);
                return key === "sum" ? new d.MathSum(options) : new d.MathIntegral(options);
            }
            throw new Error(`暂不支持公式结构：${key}；不能以截图或原始代码替代。`);
        });
    }

    function inline(line) {
        nonemptyArray(line, "行内内容");
        return line.map((node) => {
            if (typeof node === "string") {
                if (node === "\t") return new d.TextRun("\t");
                check(!/\\(?:frac|sqrt|begin|end|sum|int)\b/.test(node), "正文含未转换的LaTeX。");
                return t(node);
            }
            check(node && typeof node === "object", "行内元素无效。");
            if (Object.hasOwn(node, "math")) return new d.Math({ children: math(node.math) });
            if (Object.hasOwn(node, "image")) {
                check(node.role === "figure", "图片仅用于必要图形，数学公式不能用图片替代。");
                const imagePath = localFile(node.image, baseDirectory);
                const extension = path.extname(imagePath).toLowerCase();
                check([".png", ".jpg", ".jpeg"].includes(extension), "图形仅支持PNG或JPEG。");
                check(Number.isFinite(node.width) && node.width > 0 && Number.isFinite(node.height) && node.height > 0, "图形显示尺寸无效。");
                const scale = Math.min(1, 642 / node.width);
                return new d.ImageRun({ type: extension === ".png" ? "png" : "jpg", data: fs.readFileSync(imagePath),
                    transformation: { width: node.width * scale, height: node.height * scale },
                    altText: { title: text(node.alt, "图形说明"), description: node.alt, name: path.basename(imagePath) } });
            }
            throw new Error("行内元素应是文字、math或figure图片。");
        });
    }
    const line = (value, options = {}) => p(inline(value), {
        ...(value.length === 1 && value[0]?.display === true ? { alignment: d.AlignmentType.CENTER } : {}), ...options,
    });
    const paragraphs = (values) => values.map((value) => line(value));
    const labeled = (name, values) => values.map((value, index) => p([
        ...(index === 0 ? [t(`${name}　`, { bold: true })] : []), ...inline(value),
    ]));
    const title = (name, metadata) => [p([t(name)], { style: "Title" }), line([metadata], { spacing: { after: 160 } })];
    function sourceLine(source, prefix) {
        return p([t(`${prefix}：${source.title}；${source.locator}。`, { size: 22 }),
            new d.ExternalHyperlink({ link: source.url, children: [t("来源链接", { color: "000000", size: 22, underline: {} })] })]);
    }
    function table(headers, rows, widths) {
        const border = { style: d.BorderStyle.SINGLE, size: 4, color: "D9D9D9" };
        return new d.Table({ width: { size: 9638, type: d.WidthType.DXA }, columnWidths: widths,
            borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
            rows: [headers, ...rows].map((row, rowIndex) => new d.TableRow({ tableHeader: rowIndex === 0, cantSplit: true,
                children: row.map((value, column) => new d.TableCell({
                    width: { size: widths[column], type: d.WidthType.DXA }, verticalAlign: d.VerticalAlign.CENTER,
                    margins: { top: 100, bottom: 100, left: 120, right: 120 },
                    shading: { fill: rowIndex === 0 ? "F2F2F2" : "FFFFFF", type: d.ShadingType.CLEAR },
                    children: [p([t(value, { size: 22, bold: rowIndex === 0 })], { spacing: { after: 0, line: 288 },
                        alignment: column === 0 || column === 2 ? d.AlignmentType.CENTER : d.AlignmentType.LEFT })],
                })),
            })),
        });
    }
    function questionBody(question, number) {
        const result = question.stem.map((entry, index) => line(index === 0 && number !== null ? [`${number}. `, ...entry] : entry, {
            spacing: { before: index === 0 ? 120 : 0, after: 80 }, keepNext: index < question.stem.length - 1 || Boolean(question.options),
        }));
        const options = question.options || [];
        const optionLines = options.map((option, index) => [`${String.fromCharCode(65 + index)}. `, ...option]);
        const arranged = [];
        for (let index = 0; index < optionLines.length; index += question.compact_options ? 2 : 1) {
            arranged.push(question.compact_options && index + 1 < optionLines.length
                ? [...optionLines[index], "\t", ...optionLines[index + 1]] : optionLines[index]);
        }
        arranged.forEach((option, index) => result.push(line(option, { spacing: { after: 40 }, keepNext: index < arranged.length - 1,
            tabStops: [{ type: d.TabStopType.LEFT, position: 4819 }] })));
        return result;
    }
    function solution(question) {
        return [...labeled("解题思路", question.solution.idea), ...labeled("关键步骤", question.solution.steps), ...labeled("最终答案", question.solution.answer)];
    }

    const documents = [];
    if (mode === "plan") {
        const body = title("数学家教课程计划", `${plan.student_stage}　${plan.scope}　${plan.lesson_count}次课　每次${plan.duration_minutes}分钟`);
        body.push(h1("课程总览"), table(["课次", "授课主题", "时长"], plan.lessons.map((lesson) => [`第${lesson.number}课`, lesson.title, `${plan.duration_minutes}分钟`]), [1200, 7038, 1400]));
        plan.lessons.forEach((lesson) => body.push(h1(`第${lesson.number}课 ${lesson.title}`),
            ...labeled("学习目标", lesson.goals.map((entry) => [entry])), ...labeled("重点难点", lesson.focus.map((entry) => [entry])),
            table(["教学环节", "内容安排", "用时"], lesson.activities.map((activity) => [activity.name, activity.content, `${activity.minutes}分钟`]), [1800, 6438, 1400])));
        documents.push(["课程计划.docx", body]);
    } else {
        const selected = plan.lessons.find((lesson) => lesson.number === data.number);
        const metadata = `${plan.student_stage}　${plan.scope}　每次${plan.duration_minutes}分钟`;
        const prefix = `第${String(data.number).padStart(2, "0")}课`;
        const knowledge = title(`第${data.number}课 ${selected.title} 知识点资料`, metadata);
        let exampleNumber = 0;
        data.knowledge.forEach((section) => {
            knowledge.push(h1(section.title), ...paragraphs(section.paragraphs));
            section.examples.forEach((example) => knowledge.push(h2(`例${++exampleNumber}`), ...questionBody(example, null), ...solution(example)));
        });
        if (data.reference_note) knowledge.push(line([data.reference_note]));
        if (data.references.length) knowledge.push(h1("参考资料"), ...data.references.map((entry) => sourceLine(entry, "参考")));
        documents.push([`${prefix}_知识点资料.docx`, knowledge]);
        const ordered = data.exercises.map((question, index) => ({ question, index })).sort((a, b) =>
            LEVELS.indexOf(a.question.level) - LEVELS.indexOf(b.question.level) || TYPES.indexOf(a.question.type) - TYPES.indexOf(b.question.type) || a.index - b.index).map((entry) => entry.question);
        const originalCount = ordered.filter((question) => question.level === "真题").length;
        const missing = TYPES.map((type, index) => `${type}${ORIGINAL_QUOTA[index] - ordered.filter((question) => question.level === "真题" && question.type === type).length}题`).join("、");
        for (const answers of [false, true]) {
            const suffix = answers ? "答案解析" : "练习题";
            const body = title(`第${data.number}课 ${selected.title} ${suffix}`, metadata);
            body.push(line([`本次含45道AI生成题、${originalCount}道历年原题，共${ordered.length}题。知识点例题另计。`]));
            if (originalCount < 10) body.push(line([`真题未满足标准10题；题型缺额：${missing}。未用生成题填补。`]));
            let number = 0;
            LEVELS.forEach((level) => {
                body.push(h1(level === "真题" ? "历年真题专项" : `${level}题`));
                body.push(line([level === "真题" ? "本区为实际收录原题，出处逐题标注。" : "本区题目由AI生成。"]));
                if (level === "真题" && originalCount === 0) body.push(line(["本次未收录可核验原题，数量及来源要求未满足。"]));
                TYPES.forEach((type, typeIndex) => {
                    const group = ordered.filter((question) => question.level === level && question.type === type);
                    if (group.length) body.push(h2(TYPE_LABELS[typeIndex]));
                    group.forEach((question) => {
                        body.push(...questionBody(question, ++number));
                        if (level === "真题") body.push(sourceLine(question.source, "原题出处"));
                        if (answers) {
                            if (level === "真题") body.push(line(["以下解析由AI编写，不是官方解析。"]));
                            body.push(...solution(question));
                        }
                    });
                });
            });
            documents.push([`${prefix}_${suffix}.docx`, body]);
        }
    }

    const files = [];
    for (const [filename, children] of documents) {
        const document = new d.Document({ creator: "数学家教备课", features: { updateFields: true },
            styles: { default: { document: { run: { font: FONT, size: 24, color: "000000" }, paragraph: { spacing: { after: 80, line: 312 } } } },
                paragraphStyles: [
                    { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: HEADING_FONT, size: 36, color: "000000", bold: false }, paragraph: { alignment: d.AlignmentType.CENTER, spacing: { after: 200 }, keepNext: true } },
                    { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: HEADING_FONT, size: 28, color: "000000", bold: false }, paragraph: { outlineLevel: 0, spacing: { before: 220, after: 100 }, keepNext: true } },
                    { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 24, bold: true, color: "000000" }, paragraph: { outlineLevel: 1, spacing: { before: 140, after: 80 }, keepNext: true } },
                ] },
            sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134, footer: 500 } } },
                footers: { default: new d.Footer({ children: [p([new d.TextRun({ children: [d.PageNumber.CURRENT], size: 20 })], { alignment: d.AlignmentType.CENTER })] }) }, children }],
        });
        const zip = await JSZip.loadAsync(await d.Packer.toBuffer(document));
        const settings = await zip.file("word/settings.xml").async("string");
        zip.file("word/settings.xml", settings.replace("</w:settings>", `<m:mathPr xmlns:m="${MATH_NS}"><m:mathFont m:val="Cambria Math"/></m:mathPr></w:settings>`));
        files.push({ filename, buffer: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }) });
    }
    return files;
}

async function main() {
    const [mode, input, ...options] = process.argv.slice(2);
    check(input && options.length % 2 === 0, "用法：node render_materials.cjs plan|lesson input.json --out 新目录 [--deps node_modules目录]");
    const flags = {};
    for (let index = 0; index < options.length; index += 2) {
        check(["--out", "--deps"].includes(options[index]) && !Object.hasOwn(flags, options[index]), "参数无效或重复。");
        flags[options[index]] = options[index + 1];
    }
    check(flags["--out"], "请指定--out输出目录。");
    const inputPath = path.resolve(input);
    const files = await buildMaterials(mode, JSON.parse(fs.readFileSync(inputPath, "utf8")), path.dirname(inputPath), flags["--deps"]);
    const outputDirectory = path.resolve(flags["--out"]);
    files.forEach((file) => check(!fs.existsSync(path.join(outputDirectory, file.filename)), `目标已存在，不覆盖：${file.filename}`));
    fs.mkdirSync(outputDirectory, { recursive: true });
    files.forEach((file) => fs.writeFileSync(path.join(outputDirectory, file.filename), file.buffer, { flag: "wx" }));
    console.log(JSON.stringify({ files: files.map((file) => path.join(outputDirectory, file.filename)), note: "已生成文件；数学、来源真实性和页面效果仍需分别检查。" }, null, 2));
}

module.exports = { validatePlan, validateLesson, buildMaterials };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
