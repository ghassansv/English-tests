# STUDY_DOCUMENT_V1_SPEC

## 1. Purpose

`study-document/v1` is the canonical semantic model for reconstructing
noisy, skewed, blurred, photographed, or scanned English study/exam
pages as clean adaptive A4 pages.

The model describes **what the page contains and how content is
semantically grouped**. It does not copy source geometry or visual
defects.

The renderer owns typography, spacing, pagination, exact dimensions, and
final A4 composition.

## 2. Core principles

1.  Preserve reading order.
2.  Preserve clearly readable English verbatim. Do not correct grammar
    or spelling.
3.  Preserve answer gaps in their exact semantic position.
4.  Describe semantic structure, not source coordinates.
5.  Do not answer questions or fill gaps.
6.  Use only the eight node types defined below.
7.  Prefer composition of primitives over special page templates.
8.  The final renderer may reflow content to use A4 space cleanly.
9.  Source page type is never required.
10. Mixed pages are valid.

## 3. Root object

``` json
{
  "schemaVersion": "study-document/v1",
  "documentId": "doc-001",
  "pageNumber": 1,
  "source": {
    "kind": "page-image",
    "sourcePageIndex": 0
  },
  "content": []
}
```

Allowed root fields only: - `schemaVersion` - `documentId` -
`pageNumber` - `source` - `content`

`schemaVersion` MUST equal `study-document/v1`.

## 4. Forbidden fields

The semantic model MUST NOT contain source geometry or styling fields,
including:

-   `x`
-   `y`
-   `left`
-   `top`
-   `right`
-   `bottom`
-   `width`
-   `height`
-   `boundingBox`
-   `bbox`
-   `polygon`
-   `coordinates`
-   `fontSize`
-   `fontFamily`
-   `fontWeight`
-   `color`

`graphic.aspectRatio` and semantic enum `graphic.size` are exceptions
because they express rendering intent rather than source coordinates.

## 5. Allowed node types

Exactly eight node types are allowed:

1.  `group`
2.  `text`
3.  `flow`
4.  `gap`
5.  `list`
6.  `graphic`
7.  `table`
8.  `rule`

Unknown node types MUST be rejected.

------------------------------------------------------------------------

## 6. group

General semantic grouping and layout intent.

``` json
{
  "type": "group",
  "id": "group-001",
  "role": "question",
  "layout": "block",
  "children": []
}
```

Required: - `type` - `id` - `role` - `layout` - `children`

Optional: - `columnCount` - `flowMode`

Allowed `role`: - `page-header` - `page-footer` - `section` -
`article` - `question` - `question-set` - `instruction-box` -
`quote-box` - `quote-bubble` - `answer-area` - `content-box` -
`score-area` - `caption-group` - `generic`

Allowed `layout`: - `block` - `row` - `columns` - `grid`

`columnCount`: - allowed only for `columns` or `grid` - allowed values:
`2`, `3`, `4`

`flowMode`: - allowed only for `columns` - allowed values: `continuous`,
`fixed`

`continuous` means content flows from one column to the next. `fixed`
means children represent independent column content.

For `flowMode: "fixed"`:

-   `columnCount` is required.
-   `children` MUST contain exactly `columnCount` direct `group` nodes.
-   Each direct child group MUST use `layout: "block"` and represents one
    semantic column.
-   Column groups MUST be ordered in the page's reading order.
-   Content belonging to a column, including graphics, captions, credits, and
    notes, MUST remain inside that column group in top-to-bottom order.

Content that visibly spans the column set is not owned by a single column and
MUST be placed before or after the fixed-columns group according to reading
order.

------------------------------------------------------------------------

## 7. text

Represents all textual content.

``` json
{
  "type": "text",
  "id": "text-001",
  "role": "body",
  "value": "Example text."
}
```

Required: - `type` - `id` - `role` - `value`

Allowed `role`: - `title` - `subtitle` - `heading` - `body` -
`instruction` - `question` - `number` - `option` - `caption` -
`attribution` - `label` - `footer` - `header` - `note`

Text styling is renderer-owned.

------------------------------------------------------------------------

## 8. flow

Represents inline semantic flow where text, answer gaps, or inline
graphics must remain in one logical sequence.

``` json
{
  "type": "flow",
  "id": "flow-001",
  "children": [
    {
      "type": "text",
      "id": "text-001",
      "role": "body",
      "value": "They hope to live happily "
    },
    {
      "type": "gap",
      "id": "gap-001",
      "display": "inline",
      "style": "line",
      "size": "medium"
    },
    {
      "type": "text",
      "id": "text-002",
      "role": "body",
      "value": " after."
    }
  ]
}
```

Required: - `type` - `id` - `children`

Allowed child node types: - `text` - `gap` - `graphic`

A graphic inside `flow` MUST use `placement: "inline"`.

------------------------------------------------------------------------

## 9. gap

Represents any answer location.

``` json
{
  "type": "gap",
  "id": "gap-001",
  "display": "inline",
  "style": "line",
  "size": "medium"
}
```

Required: - `type` - `id` - `display` - `style`

Optional: - `size` - `lines` - `label`

Allowed `display`: - `inline` - `block`

Allowed `style`: - `line` - `box` - `blank`

Allowed `size` for inline gaps only: - `small` - `medium` - `large`

Allowed `lines` for block gaps only: - `1` - `2` - `3` - `4` - `5` - `6`

A visible blank inside a sentence MUST be represented by a `gap` at the
exact semantic position in a `flow`.

When a gap is itself a visibly numbered answer item, its `label` MUST equal
that visible question number exactly (for example `"14"`). Numbered gaps do
not need artificial `group(role: "question")` wrappers: official answers map
directly to the gap by `label`.

------------------------------------------------------------------------

## 10. list

Represents choices, questions, steps, bullets, and checklists.

``` json
{
  "type": "list",
  "id": "list-001",
  "role": "choices",
  "marker": "letters",
  "selectionControl": "checkbox",
  "items": []
}
```

Required: - `type` - `id` - `role` - `marker` - `items`

Optional: - `selectionControl`

Allowed `role`: - `choices` - `questions` - `steps` - `bullets` -
`checklist` - `generic`

Allowed `marker`: - `none` - `bullet` - `number` - `letters` -
`checkbox`

Allowed `selectionControl`: - `checkbox`

`selectionControl` represents an additional visible response control after
every item. It is allowed only for `role: "choices"` with
`marker: "letters"`. Use it when the source shows both A/B/C/D labels and a
separate square for every option. The renderer creates exactly one square per
list item; no separate node or geometry is used.

Each item:

``` json
{
  "id": "item-001",
  "children": []
}
```

For multiple-choice questions: - use `role: "choices"` - use
`marker: "letters"` - do not duplicate A/B/C/D inside option text when
the labels are structurally separable - add `selectionControl: "checkbox"`
when a separate square is visibly printed after every option

------------------------------------------------------------------------

## 11. graphic

Represents photographs, illustrations, diagrams, maps, charts, icons,
and decorative graphics.

``` json
{
  "type": "graphic",
  "id": "graphic-001",
  "role": "photo",
  "assetId": null,
  "placement": "block",
  "size": "full",
  "placeholder": true,
  "aspectRatio": 1.6
}
```

Required: - `type` - `id` - `role` - `assetId` - `placement` - `size` -
`placeholder`

Optional: - `aspectRatio`

Allowed `role`: - `photo` - `illustration` - `diagram` - `map` -
`chart` - `icon` - `decorative` - `unknown`

Allowed `placement`: - `block` - `center` - `left` - `right` -
`float-left` - `float-right` - `inline`

Allowed `size`: - `small` - `medium` - `large` - `full`

If no extracted asset exists: - `assetId` MUST be `null` - `placeholder`
MUST be `true`

If an extracted asset is attached: - `assetId` MUST be a non-empty opaque
identifier resolved by the application asset store - `placeholder` MUST be
`false`

The image bytes, file URL, source crop, and crop coordinates are external
asset metadata and MUST NOT be embedded in `study-document/v1`. Attaching or
replacing a crop changes only the external asset record and the graphic's
`assetId`, `placeholder`, and derived `aspectRatio`. A translation overlay uses
the same graphic asset and MUST NOT duplicate it.

`aspectRatio`, when present, MUST be a positive number.

------------------------------------------------------------------------

## 12. table

Use only for real row-column relationships.

``` json
{
  "type": "table",
  "id": "table-001",
  "role": "score-table",
  "rows": []
}
```

Required: - `type` - `id` - `role` - `rows`

Allowed `role`: - `data-table` - `score-table` - `answer-table` -
`comparison-table` - `generic`

Row:

``` json
{
  "id": "row-001",
  "cells": []
}
```

Cell:

``` json
{
  "id": "cell-001",
  "children": []
}
```

Do not use tables merely to imitate visual alignment.

------------------------------------------------------------------------

## 13. rule

Represents a meaningful divider or decorative line.

``` json
{
  "type": "rule",
  "id": "rule-001",
  "role": "section-separator"
}
```

Required: - `type` - `id` - `role`

Allowed `role`: - `section-separator` - `title-extension` -
`content-divider` - `footer-divider` - `decorative`

------------------------------------------------------------------------

# 14. Composition rules

The AI MUST construct a semantic tree from visible evidence. It MUST NOT
choose a page template.

## Title or heading

Use `text` with the appropriate role.

## Question

Use:

`group(role=question)` containing the question content and its response
structure.

## Question number

When structurally separable, represent the number as `text(role=number)`
rather than merging it into question text.

## Multiple choice

Compose:

`group(question) + text(question) + list(role=choices, marker=letters)`

If every lettered option also has a separate printed square, add
`selectionControl: "checkbox"` to the choices list. Do not replace the letter
marker with `marker: "checkbox"`, because both visual elements are present.

## Inline answer blank

Compose:

`flow(text + gap(display=inline) + text)`

The gap must remain exactly between the surrounding textual fragments.

## Open short answer

Compose:

`group(question) + text(question) + gap(display=block, lines=1 or appropriate visible count)`

## Long answer area

Use a block `gap` with the visible/intended answer-line count, capped by
the schema.

## Article or reading passage

Use `group(role=article)`.

Preserve every visible paragraph boundary. Represent each visible paragraph as
one `text(role=body)` node, or as one `flow` when the paragraph contains inline
gaps or graphics. Do not merge separate paragraphs. Do not split one paragraph
because of line wrapping, a column break, or a page break.

For a real continuous multi-column passage with no content owned by a specific
column: - `layout: "columns"` - `flowMode: "continuous"`

Use `flowMode: "fixed"` when columns have independent content or when a graphic,
caption, credit, note, box, or other element belongs to one particular column.
Create exactly one block-layout child group per column and keep each column's
content inside its group in top-to-bottom order.

## Instruction box

Use `group(role=instruction-box)`.

## Quote box or speech bubble

Use `group` with `role: "quote-box"` or `role: "quote-bubble"`.

The quotation is `text`. The speaker/source is `text(role=attribution)`.

## Image or visual region

Use `graphic`.

Do not convert text printed as ordinary document text into a graphic
merely because OCR is difficult.

Preserve the graphic's semantic ownership without source coordinates:

-   A graphic inside one column stays inside that column group at its visible
    position between the surrounding content.
-   A caption, attribution, permission line, or credit stays immediately after
    the graphic inside the same owning group.
-   A graphic spanning multiple columns or centered across the column set stays
    outside the column groups, before or after them according to reading order.
-   Never assume left, right, or center placement from a page template; infer it
    from the attached page image each time.

## Real table

Use `table` only if cells have meaningful row-column relationships.

## Visual separator

Use `rule` only when a visible line has structural or decorative
significance.

## Mixed page

A page may freely compose articles, questions, lists, gaps, graphics,
boxes, tables, and rules in reading order.

No `pageType` selection is required.

------------------------------------------------------------------------

# 15. AI extraction rules

1.  Return only valid JSON.
2.  `schemaVersion` must be exactly `study-document/v1`.
3.  Use only: `group`, `text`, `flow`, `gap`, `list`, `graphic`,
    `table`, `rule`.
4.  Never invent node types.
5.  Every node, list item, row, and cell ID must be unique within the
    page JSON.
6.  Never use source geometry or forbidden styling fields.
7.  Preserve reading order.
8.  Copy clearly readable English exactly.
9.  Do not silently correct spelling, grammar, capitalization, or
    punctuation.
10. Do not answer questions.
11. Do not fill answer gaps.
12. Preserve visible inline answer blanks in their exact semantic
    position.
13. Use `list(role=choices)` for multiple-choice options.
14. Preserve separate selection squares on lettered choices with
    `selectionControl: "checkbox"`; one list item produces one square.
15. Keep structurally separable question numbers separate from question
    text.
16. Represent visual content with `graphic`.
17. Preserve every visible paragraph as a separate semantic paragraph; do not
    merge paragraphs or split them because of visual line or column wrapping.
18. Preserve column ownership for graphics, captions, credits, notes, and boxes.
19. Use fixed columns with one block-layout child group per column when any
    content belongs to a specific column.
20. Keep spanning graphics outside column groups in reading order.
21. If an asset is unavailable, use a graphic placeholder.
22. Do not use `table` for visual alignment.
23. Use `table` only for true row-column relationships.
24. Do not add visual styling fields.
25. Return the semantic document tree, not a prose description.
26. Do not invent unreadable text. If content cannot be read reliably,
    preserve only supported readable content and structure.
27. Do not reproduce scan defects, skew, perspective, blur, shadows, or
    accidental page artifacts.
28. Do not add content absent from the source page.
29. Do not merge distinct questions or options.
30. Do not split a single logical sentence merely because it wraps
    visually.

------------------------------------------------------------------------

# 16. Example: Multiple choice

``` json
{
  "schemaVersion": "study-document/v1",
  "documentId": "doc-001",
  "pageNumber": 5,
  "source": {
    "kind": "page-image",
    "sourcePageIndex": 4
  },
  "content": [
    {
      "type": "group",
      "id": "question-001",
      "role": "question",
      "layout": "block",
      "children": [
        {
          "type": "group",
          "id": "question-header-001",
          "role": "generic",
          "layout": "row",
          "children": [
            {
              "type": "text",
              "id": "question-number-001",
              "role": "number",
              "value": "4"
            },
            {
              "type": "text",
              "id": "question-text-001",
              "role": "question",
              "value": "What led Skaife to join the military?"
            }
          ]
        },
        {
          "type": "list",
          "id": "choices-001",
          "role": "choices",
          "marker": "letters",
          "selectionControl": "checkbox",
          "items": [
            {
              "id": "choice-001",
              "children": [
                {
                  "type": "text",
                  "id": "choice-text-001",
                  "role": "option",
                  "value": "Great opportunities"
                }
              ]
            },
            {
              "id": "choice-002",
              "children": [
                {
                  "type": "text",
                  "id": "choice-text-002",
                  "role": "option",
                  "value": "A coincidence"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

# 17. Example: Inline gap

``` json
{
  "schemaVersion": "study-document/v1",
  "documentId": "doc-002",
  "pageNumber": 1,
  "source": {
    "kind": "page-image",
    "sourcePageIndex": 0
  },
  "content": [
    {
      "type": "list",
      "id": "question-list",
      "role": "questions",
      "marker": "number",
      "items": [
        {
          "id": "question-item-001",
          "children": [
            {
              "type": "flow",
              "id": "question-flow-001",
              "children": [
                {
                  "type": "text",
                  "id": "text-a",
                  "role": "body",
                  "value": "When people marry, they normally hope to live happily "
                },
                {
                  "type": "gap",
                  "id": "gap-001",
                  "display": "inline",
                  "style": "line",
                  "size": "medium"
                },
                {
                  "type": "text",
                  "id": "text-b",
                  "role": "body",
                  "value": " after."
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

# 18. Example: Continuous columns

``` json
{
  "type": "group",
  "id": "article-001",
  "role": "article",
  "layout": "columns",
  "columnCount": 2,
  "flowMode": "continuous",
  "children": [
    {
      "type": "text",
      "id": "article-text-001",
      "role": "body",
      "value": "Article text continues naturally through the columns."
    }
  ]
}
```

# 19. Example: Fixed columns with a column-owned graphic

``` json
{
  "type": "group",
  "id": "article-fixed-columns",
  "role": "article",
  "layout": "columns",
  "columnCount": 2,
  "flowMode": "fixed",
  "children": [
    {
      "type": "group",
      "id": "article-column-1",
      "role": "generic",
      "layout": "block",
      "children": [
        {
          "type": "text",
          "id": "paragraph-1",
          "role": "body",
          "value": "First visible paragraph in the first column."
        },
        {
          "type": "text",
          "id": "paragraph-2",
          "role": "body",
          "value": "Second visible paragraph in the first column."
        }
      ]
    },
    {
      "type": "group",
      "id": "article-column-2",
      "role": "generic",
      "layout": "block",
      "children": [
        {
          "type": "text",
          "id": "paragraph-3",
          "role": "body",
          "value": "Visible paragraph in the second column."
        },
        {
          "type": "graphic",
          "id": "photo-1",
          "role": "photo",
          "assetId": null,
          "placement": "center",
          "size": "full",
          "placeholder": true,
          "aspectRatio": 1.5
        },
        {
          "type": "text",
          "id": "photo-credit-1",
          "role": "attribution",
          "value": "Photo credit"
        },
        {
          "type": "text",
          "id": "photo-permission-1",
          "role": "note",
          "value": "Used with permission"
        }
      ]
    }
  ]
}
```

The second column owns the graphic and its credit in this example. If the
source image places them in another column, move the complete graphic-credit
sequence to that column group. If the graphic spans the column set, place it
outside `article-fixed-columns` instead.

# 20. Example: Mixed composition

``` json
{
  "schemaVersion": "study-document/v1",
  "documentId": "doc-mixed",
  "pageNumber": 1,
  "source": {
    "kind": "page-image",
    "sourcePageIndex": 0
  },
  "content": [
    {
      "type": "text",
      "id": "title-001",
      "role": "title",
      "value": "Example Page"
    },
    {
      "type": "group",
      "id": "instructions-001",
      "role": "instruction-box",
      "layout": "block",
      "children": [
        {
          "type": "text",
          "id": "instruction-text-001",
          "role": "instruction",
          "value": "Read the text and answer the questions."
        }
      ]
    },
    {
      "type": "graphic",
      "id": "graphic-001",
      "role": "photo",
      "assetId": null,
      "placement": "block",
      "size": "full",
      "placeholder": true,
      "aspectRatio": 1.6
    },
    {
      "type": "group",
      "id": "question-001",
      "role": "question",
      "layout": "block",
      "children": [
        {
          "type": "text",
          "id": "question-text-001",
          "role": "question",
          "value": "What is the main idea?"
        },
        {
          "type": "gap",
          "id": "answer-001",
          "display": "block",
          "style": "line",
          "lines": 2
        }
      ]
    }
  ]
}
```

# 21. Validation requirements

The implementation validator MUST reject:

-   wrong schema version
-   unknown root fields
-   unknown node types
-   unknown node fields
-   invalid enum values
-   duplicate IDs
-   forbidden geometry or styling fields
-   invalid `columnCount`
-   `columnCount` on unsupported layouts
-   `flowMode` outside column groups
-   fixed columns without `columnCount`
-   fixed columns whose direct children are not exactly one block-layout group
    per column
-   invalid `selectionControl`
-   `selectionControl` outside a lettered choices list
-   unsupported child types inside `flow`
-   non-inline graphics inside `flow`
-   `size` on block gaps
-   `lines` on inline gaps
-   invalid graphic placeholder/asset combinations
-   non-positive `aspectRatio`

The schema is a canonical contract. Implementations MUST NOT silently
redesign, extend, rename, or reinterpret it.
