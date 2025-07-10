import path from "path";
import fs from "fs";
import inquirer from "inquirer";
import * as prettier from "prettier";
import handlebars from "handlebars";
import { $, cd } from "zx";

let BASE_DIR;
let config;
let configLocalPath;
let COMPONENTS_DIR;

const init = (options) => {
  BASE_DIR = options.BASE_DIR;
  config = options.config;
  configLocalPath = options.configLocalPath;
  COMPONENTS_DIR = options.COMPONENTS_DIR;
};

const checkRequiredEnvVars = (requiredEnvVars) => {
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(`Error: ${envVar} is not set in .env or .env.local`);
      process.exit(1);
    }
  }
};

const setK8sContext = async () => {
  //   const contextFile = path.join(BASE_DIR, ".kubeconfig");
  //   if (fs.existsSync(contextFile)) {
  //     process.env.KUBECONFIG = contextFile;
  //     return;
  //   }
  //   const { EKS_CLUSTER_NAME, REGION } = process.env;
  //   const contextName = `${EKS_CLUSTER_NAME}-${REGION}`;
  //   await $`kubectl config view --raw --minify --flatten --context=${contextName} > ${contextFile}`;
  //   process.env.KUBECONFIG = contextFile;
  //   await $`kubectl config use-context ${contextName}`;
};
// Model Management
const model = (function () {
  const configureModels = async (models, categoryDir, componentDir) => {
    const questions = models.map((model) => ({
      type: "confirm",
      name: model.name,
      message: `Deploy ${model.name}?`,
      default: model.deploy,
    }));
    const answers = await inquirer.prompt(questions);
    config[categoryDir][componentDir].models = models.map((model) => ({
      name: model.name,
      deploy: answers[model.name],
    }));
    const prettierConfig = await prettier.resolveConfig(path.join(BASE_DIR, ".prettierrc"));
    const formattedConfig = await prettier.format(JSON.stringify(config), {
      ...prettierConfig,
      parser: "json",
    });
    fs.writeFileSync(configLocalPath, formattedConfig);
  };

  const updateModels = async (models, categoryDir, componentDir) => {
    await setK8sContext();
    const MODELS_DIR = path.join(COMPONENTS_DIR, categoryDir, componentDir);
    const { enableNeuron } = config[categoryDir][componentDir];
    let IMAGE;
    if (enableNeuron) {
      const ecrRepoUrl = await terraform.output(MODELS_DIR, { outputName: "ecr_repository_url" });
      IMAGE = `${ecrRepoUrl}:latest`;
    }
    for (const model of models) {
      if (model.neuron) {
        const modelTemplatePath = path.join(MODELS_DIR, `model-${model.name}.template.yaml`);
        const modelRenderedPath = path.join(MODELS_DIR, `model-${model.name}.rendered.yaml`);
        const modelTemplateString = fs.readFileSync(modelTemplatePath, "utf8");
        const modelTemplate = handlebars.compile(modelTemplateString);
        const modelVars = { IMAGE };
        fs.writeFileSync(modelRenderedPath, modelTemplate(modelVars));
        if (model.deploy) {
          await $`kubectl apply -f ${modelRenderedPath}`;
        } else {
          await $`kubectl delete -f ${modelRenderedPath} --ignore-not-found`;
        }
        continue;
      }
      if (model.deploy) {
        await $`kubectl apply -f ${path.join(MODELS_DIR, `model-${model.name}.yaml`)}`;
      } else {
        await $`kubectl delete -f ${path.join(MODELS_DIR, `model-${model.name}.yaml`)} --ignore-not-found`;
      }
    }
  };

  const addModels = async (models, categoryDir, componentDir) => {
    await setK8sContext();
    const MODELS_DIR = path.join(COMPONENTS_DIR, categoryDir, componentDir);
    const { enableNeuron } = config[categoryDir][componentDir];
    let IMAGE;
    if (enableNeuron) {
      const ecrRepoUrl = await terraform.output(MODELS_DIR, { outputName: "ecr_repository_url" });
      IMAGE = `${ecrRepoUrl}:latest`;
    }
    for (const model of models) {
      if (!model.deploy) {
        continue;
      }
      if (model.neuron && componentDir === "vllm") {
        const modelTemplatePath = path.join(MODELS_DIR, `model-${model.name}.template.yaml`);
        const modelRenderedPath = path.join(MODELS_DIR, `model-${model.name}.rendered.yaml`);
        const modelTemplateString = fs.readFileSync(modelTemplatePath, "utf8");
        const modelTemplate = handlebars.compile(modelTemplateString);
        const modelVars = { IMAGE };
        fs.writeFileSync(modelRenderedPath, modelTemplate(modelVars));
        await $`kubectl apply -f ${modelRenderedPath}`;
        continue;
      }
      await $`kubectl apply -f ${path.join(MODELS_DIR, `model-${model.name}.yaml`)}`;
    }
  };

  const removeAllModels = async (models, categoryDir, componentDir) => {
    await setK8sContext();
    const MODELS_DIR = path.join(COMPONENTS_DIR, categoryDir, componentDir);
    const { enableNeuron } = config[categoryDir][componentDir];
    let IMAGE;
    if (enableNeuron) {
      const ecrRepoUrl = await terraform.output(MODELS_DIR, { outputName: "ecr_repository_url" });
      IMAGE = `${ecrRepoUrl}:latest`;
    }
    for (const model of models) {
      if (model.neuron && componentDir === "vllm") {
        const modelTemplatePath = path.join(MODELS_DIR, `model-${model.name}.template.yaml`);
        const modelRenderedPath = path.join(MODELS_DIR, `model-${model.name}.rendered.yaml`);
        const modelTemplateString = fs.readFileSync(modelTemplatePath, "utf8");
        const modelTemplate = handlebars.compile(modelTemplateString);
        const modelVars = { IMAGE };
        fs.writeFileSync(modelRenderedPath, modelTemplate(modelVars));
        await $`kubectl delete -f ${modelRenderedPath} --ignore-not-found`;
        continue;
      }
      await $`kubectl delete -f ${path.join(MODELS_DIR, `model-${model.name}.yaml`)} --ignore-not-found`;
    }
  };
  return { configureModels, updateModels, addModels, removeAllModels };
})();

// Terraform
const terraform = (function () {
  const setupWorkspace = async function (TERRAFORM_DIR) {
    const requiredEnvVars = ["REGION", "EKS_CLUSTER_NAME", "DOMAIN"];
    checkRequiredEnvVars(requiredEnvVars);
    const { REGION, EKS_CLUSTER_NAME, DOMAIN } = process.env;
    try {
      cd(TERRAFORM_DIR);
      await $`terraform init`;
      await $`terraform workspace new ${REGION}`;
    } catch (error) {}
    try {
      cd(TERRAFORM_DIR);
      await $`mkdir -p workspaces/${REGION}`;
      const content = `region = "${REGION}"\n` + `name = "${EKS_CLUSTER_NAME}"\n` + `domain = "${DOMAIN}"\n`;
      fs.writeFileSync(`workspaces/${REGION}/terraform.tfvars`, content);
    } catch (error) {
      throw new Error(error);
    }
  };

  const plan = async function (TERRAFORM_DIR) {
    const { REGION } = process.env;
    try {
      await setupWorkspace(TERRAFORM_DIR);
      await $`terraform plan --var-file="workspaces/${REGION}/terraform.tfvars"`;
    } catch (error) {
      throw new Error(error);
    }
  };

  const apply = async function (TERRAFORM_DIR) {
    const { REGION } = process.env;
    try {
      await setupWorkspace(TERRAFORM_DIR);
      await $`terraform apply --var-file="workspaces/${REGION}/terraform.tfvars" --auto-approve`;
    } catch (error) {
      throw new Error(error);
    }
  };

  const destroy = async function (TERRAFORM_DIR) {
    const { REGION } = process.env;
    try {
      await setupWorkspace(TERRAFORM_DIR);
      await $`terraform destroy --var-file="workspaces/${REGION}/terraform.tfvars" --auto-approve`;
    } catch (error) {
      throw new Error(error);
    }
  };

  const output = async function (TERRAFORM_DIR, options) {
    try {
      await setupWorkspace(TERRAFORM_DIR);
      if (options.outputName) {
        const result = await $`terraform output -raw ${options.outputName}`;
        return result.stdout;
      } else {
        await $`terraform output`;
      }
    } catch (error) {
      throw new Error(error);
    }
  };

  const applyWithRetry = async (TERRAFORM_DIR, maxAttempts = 3) => {
    let attempts = 0;
    let success = false;
    await setK8sContext();
    while (!success && attempts < maxAttempts) {
      attempts++;
      try {
        console.log(`Applying Terraform (attempt ${attempts}/${maxAttempts})...`);
        await apply(TERRAFORM_DIR);
        success = true;
      } catch (error) {
        if (attempts >= maxAttempts) {
          console.error(`Failed after ${maxAttempts} attempts:`, error);
          throw error;
        }
        const waitSec = 15;
        console.warn(`Attempt ${attempts} failed:`, error);
        console.warn(`Wait for ${waitSec}s before retrying...`);
        await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
      }
    }
    return success;
  };

  return { setupWorkspace, plan, apply, destroy, output, applyWithRetry };
})();

export default {
  init,
  checkRequiredEnvVars,
  setK8sContext,
  model,
  terraform,
};
