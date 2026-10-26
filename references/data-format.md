# 生成器内部数据格式

这些JSON由AI准备，不是教师的新必填表单。生成器不出题、不联网，也不判断数学或来源是否真实；它把经过内容检查的数据渲染为Word，并阻止部分结构性错误。

## 调用

使用依赖加载工具返回的内置Node绝对路径运行：

```text
node scripts/render_materials.cjs plan confirmed-plan.json --out output-plan
node scripts/render_materials.cjs lesson lesson.json --out output-lesson
```

必要时末尾加`--deps 依赖加载工具返回的node_modules目录`。通常内置Node能自动定位该目录。运行前遵循当前文档技能的操作标记要求。默认文件名为“课程计划.docx”及“第NN课_知识点资料.docx”“第NN课_练习题.docx”“第NN课_答案解析.docx”；这是首版实现约定，不代表用户先前已逐一确认命名，不影响文件内容结构。

每次使用新的输出目录，同名目标存在时拒绝覆盖。内部JSON和图片与生成文件分开存放。不要改写已确认计划来绕过确认步骤。

## 课程计划

```json
{
  "student_stage": "九年级",
  "scope": "一元二次方程复习",
  "lesson_count": 1,
  "duration_minutes": 90,
  "confirmed": false,
  "lessons": [{
    "number": 1,
    "title": "解法选择与条件检查",
    "goals": ["能按方程结构选择解法"],
    "focus": ["二次项系数非零与判别式条件"],
    "activities": [
      {"name": "回顾与梳理", "content": "一般式与方法条件", "minutes": 25},
      {"name": "例题分析", "content": "比较解法并讨论条件", "minutes": 30},
      {"name": "练习反馈与小结", "content": "教师选题、反馈并归纳", "minutes": 35}
    ]
  }]
}
```

先在对话中确认；仅在教师实际确认后把`confirmed`记为true，才能导出。这个布尔值是流程记录，不是外部授权的自动证明。课次按1至lesson_count连续排列，活动分钟数为正整数且合计等于duration_minutes。小时输入先据实际含义换算为分钟。

## 段落和公式

正文用“段落列表”，每个段落是“行内元素列表”。例如：

```json
[
  ["方程", {"math": [{"sup": ["x", "2"]}, "−5x+6=0"]}, "可用因式分解法。"],
  [{"math": ["x=", {"frac": [["−b±", {"sqrt": [{"sup": ["b", "2"]}, "−4ac"]}], "2a"]}], "display": true}]
]
```

行内文字是普通字符串，不在字符串里塞换行或原始LaTeX。`math`中的字符串成为公式文字；结构表达使用以下节点，可嵌套。中文说明放在公式外。

| 节点 | 结构 |
| --- | --- |
| 上标 | `{"sup": ["x", "2"]}` |
| 下标 | `{"sub": ["a", "n"]}` |
| 分式 | `{"frac": [分子节点或列表, 分母节点或列表]}` |
| 平方根 | `{"sqrt": [根号内节点]}` |
| 一般根式 | `{"root": {"body": [节点], "degree": "3"}}` |
| 求和 | `{"sum": {"body": [节点], "lower": "i=1", "upper": "n"}}` |
| 积分符号 | `{"integral": {"body": [节点], "lower": "0", "upper": "1"}}` |

`display: true`只在该段只有一个公式时居中显示。上述是本脚本支持的结构，不是所有数学符号的完备解析器；分段大括号、矩阵等未支持结构需另用可靠原生OMML工具处理，不能改成公式图片。

必要图形可作为独立段落中的唯一元素：

```json
[{"image": "images/figure.png", "role": "figure", "width": 320, "height": 200, "alt": "题目必要图形"}]
```

仅支持本次数据目录内的PNG、JPG或JPEG，路径不得越过该目录或通过符号链接跳出；width、height为按原比例确定的显示像素。超出正文宽度时等比例缩小。图片只能承载必要图形，不能把数学公式截图标成figure来绕过原生公式要求。

## 单课数据

顶层包含以下字段：

- `plan_file`：相对本JSON目录的已确认计划文件路径。
- `number`：教师选择的课次，必须存在于该计划。年段、课题、时长从计划取，不能另填不一致内容。
- `knowledge`：知识点分节数组；每节含`title`、`paragraphs`、`examples`。paragraphs使用上述段落列表。各节examples可为空，但知识点文件合计至少一个例题。
- `exercises`：45道生成题及实际核验的0至10道原题。不能把缩量测试当作正式资料。
- `coverage`：内部映射数组，每项含`point`、`pattern`、`method`、`question_ids`；全部生成题ID均应被映射覆盖。不打印为额外Word，也不自动证明知识覆盖完整。
- `references`：实际读取的参考正文出处数组，每项含`title`、`url`、`locator`。没有读到的资料不能填写为已读；允许空数组，但是否可无参考继续需按使用流程及实际用户决定处理。
- `reference_note`：可选的事实说明，如《五三》正文未能读取而改用哪些实际来源。

例题包含`stem`及`solution`，可有`options`，均用下述相同结构，但不计入exercises。题目结构示例：

```json
{
  "id": "g001",
  "level": "基础",
  "type": "单选",
  "stem": [["方程", {"math": [{"sup": ["x", "2"]}, "−5x+6=0"]}, "的根是"]],
  "options": [["1和6"], ["2和3"], ["−2和−3"], ["−1和−6"]],
  "compact_options": true,
  "source": {"kind": "generated"},
  "solution": {
    "idea": [["把二次三项式分解为两个一次因式。"]],
    "steps": [[{"math": ["(x−2)(x−3)=0"]}], ["由零因式积性质分别求根。"]],
    "answer": [["B；两个根为2和3。"]]
  }
}
```

这只是单题结构示例，不是可以直接交付的完整单课数据。`level`仅用基础、中档、拔尖、真题；`type`仅用单选、填空、多选、解答。选择题的options为选项数组，每个选项是一组行内元素，至少两项，保持原题实际选项；不要在选项中重复写A、B等字母，渲染器自动标注。compact_options仅在短选项确实适合每行两个时设true。

生成题必须使用`source.kind = generated`且放在前三档；真题必须放在真题分区，来源为：

```json
{"kind": "original", "title": "实际核对的考试及卷名", "url": "https://实际来源", "locator": "实际原题号或页码"}
```

字段必须来自实际核对，不能复制示例标签作为来源。URL存在与字段齐全不证明题目真实，仍需代理核对原卷、条件、选项及图形。所有题目和例题都需非空的idea、steps、answer段落列表。

渲染器按分区及单选、填空、多选、解答顺序稳定排序、连续编号，练习和解析复用同一批题干和选项。真题不足会自动列题型缺额；超过某题型的真题配额会拒绝，不能用超额类型掩盖其他类型不足。内部覆盖字段与结构检查不等于教学或数学审查。
