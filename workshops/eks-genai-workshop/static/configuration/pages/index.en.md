---
title : "Page Organization"
weight : 21
---

# Folders

Organize your workshop similar to the steps within a specific workshop. For example, a workshop with 3 labs might look like this:
```aidl
    content
    ├── lab-1
    │   ├── step-1
    │   │   ├── step-1a
    │   │   │   ├── index.en.md    <-- /en/lab-1/step-1/step-1a.html (in English)
    │   │   │   └── index.fr.md    <-- /fr/lab-1/step-1/step-1a.html (in French)
    │   │   ├── step-1b
    │   │   │   ├── index.en.md    <-- /en/lab-1/step-1/step-1b.html (in English)
    │   │   │   └── index.fr.md    <-- /fr/lab-1/step-1/step-1b.html (in French)
    │   │   ├── index.en.md        <-- /en/lab-1/step-1.html (in English)
    │   │   └── index.fr.md        <-- /fr/lab-1/step-1.html (in French)
    │   ├── step-2
    │   │   ├── index.en.md        <-- /en/lab-1/step-2.html (in English)
    │   │   └── index.fr.md        <-- /fr/lab-1/step-2.html (in French)
    │   ├─── step-3
    │   │   ├── index.en.md        <-- /en/lab-1/step-3.html (in English)
    │   │   └── index.fr.md        <-- /fr/lab-1/step-4.html (in French)
    │   ├── index.en.md            <-- /en/lab-1.html (in English)
    │   └── index.fr.md            <-- /fr/lab-1.html (in French)
    ├── index.en.md                <-- /en/ (in English)
    └── index.fr.md                <-- /fr/ (in French)
```
Each folder requires at least one `index.en.md` file.

# Front matter configuration

Each page has to define a Front Matter in yaml. The front matter identified by opening and closing `---`.

# Ordering sibling menu/page entries

The simplest way is to set `weight` parameter to a number.

```yaml
---
title : "My page"
weight : 5
---
```

We recommend that you set the weight for chapters as multiple of 10, with the pages inside each folder counting down from there. For example:

Folder 1: `weight : 10`
Subfolder 1: `weight : 11`
Subfolder 2: `weight : 12`

Folder 2: `weight : 20`
Subfolder 1: `weight : 21`


### Setting title for menu entries

By default, the template will use a page's `title` attribute for the menu item (or `linkTitle` if defined).
For example (for a page named `content/install/index.en.md`):

```yaml
---
title : "Install on Linux"
weight: 10
---
```

# Images

Images and other static files should reside under the `static` folder. For example:
```markdown
![APN Logo](/static/aws-logo.png)
```
![APN Logo](/static/aws-logo.png)

The folder can have subfolder for organization. 
