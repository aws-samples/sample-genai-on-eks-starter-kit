---
title: 'Directives'
weight: 23
---

# Intro to Directives 

Directives are extensions to Markdown that allow you to create more rich and interactive content experiences using simple syntax.

## General Syntax of Directives

Directive declarations are made up of the following components:
* Colons represent the start of directives :
* After the opening colon(s), you can also include:
  * Inline content surrounded by square brackets `[A single line of content]`
  * Key/value pairs surrounded by curly braces `{key1="value1" key2='value2' key3=value3}`. Single or double quotes are optional for values without empty spaces.

Container directives do not declare inline content since content is declared within the block:
::::code{showCopyAction=true}
:::code{language="html"}
<button>
    Click for memes
</button>
:::
::::

## Type of Directives

### Text Directive
A text directive renders a directive inline with the text content.

```
View the Event Engine Wiki :link[here]{href="https://w.amazon.com/bin/view/AWS_EventEngine/" external="true"}!
```

Renders as:

View the Event Engine Wiki :link[here]{href="https://w.amazon.com/bin/view/AWS_EventEngine/" external="true"}!

::alert[The *Text Directive* is typically represented with one colon (`:`).]

---

### Leaf Directive
A leaf directive renders a directive on its own line (i.e. block level element). Think of this like a piece of content rendered inside an HTML `<div>` element.

```
::code[console.log('Hello world!');]{showCopyAction=true language="js"}
```
Renders as:
::code[console.log('Hello world!');]{showCopyAction=true language="js"}

::alert[The *Leaf Directive* is typically represented with two colons (`::`).]

---

### Container Directive
Like the leaf directive, a container directive renders content on its own line. The container directive can contain blocks of other markdown content. 

```
::::alert{type="success" header="Example notification"}
Some example text. I can also have other directives in here.
:link[Here's the Event Engine Wiki]{href="https://w.amazon.com/bin/view/AWS_EventEngine/" external="true"} in case you missed it earlier.

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
::::
```

Renders as:
::::alert{type="success" header="Example notification"}
Some example text. I can also have other directives in here.
:link[Here's the Event Engine Wiki]{href="https://w.amazon.com/bin/view/AWS_EventEngine/" external="true"} in case you missed it earlier.

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
::::

::alert[The *Container Directive* is typically wrapped with three colons (`:::`).]

---

### Nesting Directives
When nesting container directives, the outer directive must have more start/end fences `:` than the inner directive:
:::::code{showCopyAction=true}
::::tabs

:::tab{label="First"}
Some content
:::

:::tab{label="Second"}
Some other content
:::

:::tab{label="Third"}
Even more content
:::

::::
:::::

This can become quite tedious when adding additional nested directives since you would need to add additional fences `:`
to the parent containers. There is an external [feature request](https://github.com/micromark/micromark-extension-directive/issues/8) open to either inverse the behavior or just use the number of fences
regardless of depth.

## Additional Information
To add support for generic directives, this component uses the [remark-directive](https://github.com/remarkjs/remark-directive) plugin.