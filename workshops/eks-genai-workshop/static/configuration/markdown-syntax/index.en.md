---
title: 'Markdown'
weight: 22
---

You author AWS Workshop Studio content in Markdown, a plain text format for writing structured documents. Markdown is made to be easy to read and write. However, for it to work properly, you will have to follow some conventions outlined in this guide.

To see examples of the most common Markdown specifications, view the [markdown documentation](#common-markdown-specifications) below.

For a full list of Markdown specifications, refer to the [CommonMark documentation](https://spec.commonmark.org/).

---

## Escaping Characters

 

:::code{language=md showLineNumbers=false showCopyAction=true}
AWS re\:Invent
:::

will display as\: 

AWS re\:Invent

::alert[If a character does not display in your content properly, try escaping it by placing a backslash `\` immediately in front of it.]{type=error}

---

# Common Markdown specifications

The list below shows some of the most common Markdown syntax.

To view full Markdown documentation, visit [CommonMark markdown documentation](https://spec.commonmark.org/).

- [Common Markdown specifications](#common-markdown-specifications)
  - [Heading](#heading)
- [Heading 1](#heading-1)
  - [Heading 2](#heading-2)
    - [Heading 3](#heading-3)
- [Heading 1](#heading-1-1)
  - [Heading 2](#heading-2-1)
    - [Heading 3](#heading-3-1)
  - [Paragraph](#paragraph)
  - [Bold](#bold)
  - [Italic](#italic)
  - [Ordered List](#ordered-list)
  - [Unordered List](#unordered-list)
  - [Link](#link)
  - [Image](#image)
  - [Code Sample](#code-sample)
    - [Code phrase](#code-phrase)
    - [Code block](#code-block)
  - [Horizontal Rule](#horizontal-rule)
  - [Blockquote](#blockquote)

---


## Heading

Create a heading using `#` followed by a space

:::code{language=md showLineNumbers=false showCopyAction=true}
# Heading 1
## Heading 2
### Heading 3
:::

will display as\:

# Heading 1
## Heading 2
### Heading 3

---

## Paragraph

Separate paragraphs using a blank line.

:::code{language=md showLineNumbers=false showCopyAction=true}
This is my first paragraph.

This is my second paragraph.
:::

will display as\:

This is my first paragraph.

This is my second paragraph.

---

## Bold

Use two asterisks (`**`) before and after the text you want to bold.

:::code{language=md showLineNumbers=false showCopyAction=true}
I would like to bold **these words** and nothing else.
:::

will display as\:

I would like to bold **these words** and nothing else.

---

## Italic

Use one asterisks (`*`) before and after the text you want to italicize.

:::code{language=md showLineNumbers=false showCopyAction=true}
I want *these words* in italics.
:::

will display as\:

I want *these words* in italics.

---

## Ordered List

Use a number 1 followed by a period (`1.`) to start a numbered list.

:::code{language=md showLineNumbers=false showCopyAction=true}
1. This is the first step
1. This is the second step
1. This is the third step
:::

will display as\:

1. This is the first step
1. This is the second step
1. This is the third step

---

To continue the numbering of an ordered list with a comment or code block in between numbered lines.

:::code{language=md showLineNumbers=false showCopyAction=true}
1. This is the first step
1. This is the second step
1. This is the third step

    > This is a comment about the ordered list
1. This is the fourth step
:::

will display as\:

1. This is the first step
1. This is the second step
1. This is the third step

    > This is a comment about the ordered list
1. This is the fourth step
   
---

## Unordered List

Use a dash (`-`), an asterisks (`*`), or a plus sign (`+`) followed by a space to create a bulleted list.

:::code{language=md showLineNumbers=false showCopyAction=true}
- This is the first item
- This is the second item
- This is the third item
:::

will display as\:

- This is the first item
- This is the second item
- This is the third item

---

## Link

To create a link, wrap the link text in brackets (`[ ]`) followed by the url in parentheses `( )`.

Links open in a new tab by default.

:::code{language=md showLineNumbers=false showCopyAction=true}
Visit [AWS](https://aws.amazon.com) to sign up for an account.
:::

will display as\:

Visit [AWS](https://aws.amazon.com) to sign up for an account.

---

## Image

To include an image, start with an exclamation mark (`!`), followed by alt text in brackets (`[ ]`) and then the url path to the image in parentheses `( )`.

:::code{language=md showLineNumbers=false showCopyAction=true}
![AWS logo](/static/aws-logo.png)
:::

will display as\:

![AWS logo](/static/aws-logo.png)

::alert[You should include your images in the `/static` folder of your workshop build.]{header="Due to security restrictions, you cannot embed images external to your workshop"}

---

## Code Sample

### Code phrase

Use a backtick (`) before and after the code to signal that it is code.

:::code{language=md showLineNumbers=false showCopyAction=true}
In the command line, enter `cd` to change directory.
:::

will display as\:

In the command line, enter `cd` to change directory.

### Code block

Use the [code directive](link tbd) to create a block of code that is easy to copy. Before the code block include `:::code` and close the code block with `:::` (three colons). After ```:::code``` you can define properties such as `showCopyAction` (true or false), `showLineNumbers` (true or false), and `language`.

```md
:::code{showCopyAction=true showLineNumbers=true language=java}
/** 
* The HelloWorldApp class implements an application that
* simply displays "Hello World!" to the standard output.
*/

class HelloWorld {
    public static void main(String[] args) {
        System.out.println("Hello, World!"); 
    }
}
:::
```

will display as\:

:::code{showCopyAction=true showLineNumbers=true language=java}
/** 
* The HelloWorldApp class implements an application that
* simply displays "Hello World!" to the standard output.
*/

class HelloWorld {
    public static void main(String[] args) {
        System.out.println("Hello, World!"); 
    }
}
:::

---

## Horizontal Rule

Use three dashes (`---`), asterisks (`***`), or underscores (`___`) surrounded by empty lines to create a horizontal rule.

:::code{language=md showLineNumbers=false showCopyAction=true}
Above the line

---

Below the line
:::

will display as\:

Above the line

---

Below the line

---

---

## Blockquote

Use a `>` symbol in front of a paragraph to create a block quote. 

:::code{language=md showLineNumbers=false showCopyAction=true}
> If you double the number of experiments you do per year you’re going to double your inventiveness.
:::

will display as\:

> If you double the number of experiments you do per year you’re going to double your inventiveness.

---