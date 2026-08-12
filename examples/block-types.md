# Markover block-type sampler

This paragraph demonstrates **strong text**, *emphasis*, `inline code`, an
[inert link](https://example.com), and an
![image preview](../design/logo-explorations/01-editorial-redline.png). Click
the image pill to open the source image in the same preview used for annotations.

## Heading hierarchy

### A third-level heading

#### A fourth-level heading

Headings become nested sections according to their levels.

## Lists

- First unordered item
  - Nested unordered item
  - Another nested item
- Second unordered item

3. Ordered list starting at three
4. Second ordered item
   1. Nested ordered item

## Simple tasks

- [ ] Open task
- [x] Completed task
- [X] Uppercase completion marker

## Opaque block quote

> The whole quotation is one selectable block.
>
> - This embedded list renders inside it.
> - It is intentionally not available for drill-down.

## Opaque table

| Block | Structured | Drill-down |
| --- | ---: | :---: |
| Heading | yes | by section |
| Table | one node | no |

---

## Code

```js
function greet(name) {
  return `Hello, ${name}`
}
```

    This indented code block is a second code node.

## Compatibility-boundary syntax

The following examples intentionally have no specialized review node. The
public Markdown compatibility matrix records whether each construct remains
visible uninterpreted text or is preserved only in the exact reviewed source.

Strikethrough markers remain literal: ~~this is not a strikethrough node~~.

Definition term
: Definition-list syntax currently remains paragraph text.

A footnote callout [^sample] and its definition do not become footnote nodes.

[^sample]: This definition may be consumed as a CommonMark reference definition
    and is still retained in `sourceDocument.content`.

<details>
<summary>Raw HTML remains literal</summary>
There is no HTML block node and no interactive disclosure.
</details>
