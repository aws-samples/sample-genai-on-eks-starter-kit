---
title: 'Multilingual and i18n'
weight: 25
---

This template is fully compatible with multilingual mode.

# contentspec.yaml File

## File location

The contentspec.yaml file is located in the root of the workshop directory.


## Basic configuration

You define the languages your workshop supports in the `contentspec.yaml` file.

For example, to create a workshop that supports English and French, modify the `contentspec.yaml` as follows.

::alert[Content that begins with a # is a comment and does not need to be included in the contentspec.yaml. It is solely for illustrative purposes.]

:::code{language=yaml showLineNumbers=false showCopyAction=false}
version: 2.0
# default language of the content separated as languageCode-countryCode
defaultLocaleCode: en-US
# a list of all of the supported locale codes, fully qualified with languageCode-countryCode
localeCodes:
  - en-US
  - fr-FR
:::

---

# Folder Structure

After defining the supported languages in the `contentspec.yaml` file, each folder inside the `content` folder will need to include a file with the format, `index.[localeCode].md` for each `localeCode` defined. An example of the folder structure is shown below.

:::code{language=markup showLineNumbers=false showCopyAction=false}
Workshop
├── contentspec.yaml          # Configuration file that defines all supported locale codes
└── content                   # Workshop content folder
    ├── index.en.md           # Landing page localized in English
    ├── index.fr.md           # Landing page localized in French
    ├── introduction          # Introduction workshop folder
    │    ├──index.en.md       # Localized English introduction file
    │    └──index.fr.md       # Localized French introduction file
:::

---

# Localizing Page Files

You will need to localize each page content Markdown file. This is the content the user will see for each localized version. 

Below is a basic example of an English and French localized file. You would complete this localization for all page content in the workshop.

#### index.en.md
:::code{language=markdown showLineNumbers=false showCopyAction=false}
---
title : "Documentation for Learn Theme"
weight : 0
---

# Welcome
Welcome to the workshop!
:::

#### index.fr.md
:::code{language=markdown showLineNumbers=false showCopyAction=false}
---
title : "Documentation du thème Learn"
weight : 0
---

# Bienvenue
Bienvenue à l'atelier!
:::
