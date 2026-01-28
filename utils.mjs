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
  configLocalPath = path.join(BASE_DIR, "config.local.json");
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
  const { EKS_CLUSTER_NAME, REGION } = process.env;
  const contextName = `${EKS_CLUSTER_NAME}-${REGION}`;
  await $`kubectl config use-context ${contextName}`;
};

const renderTemplate = (templatePath, renderedPath, vars) => {
  const templateString = fs.readFileSync(templatePath, "utf8");
  const template = handlebars.compile(templateString);
  fs.writeFileSync(renderedPath, template(vars));
};

// ECR Pull Through Cache 
const getImagePrefixes = () => {
  const enabled = config?.terraform?.vars?.enable_ecr_pull_through_cache;
  const { REGION, AWS_ACCOUNT_ID } = process.env;
  const ecrBase = enabled ? `${AWS_ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com` : "";

  return {
    // Docker Hub: empty when disabled, ECR prefix when enabled
    DOCKER_IMAGE_PREFIX: enabled ? `${ecrBase}/docker-hub/` : "",
    // GHCR: ghcr.io/ when disabled, ECR prefix when enabled
    GHCR_IMAGE_PREFIX: enabled ? `${ecrBase}/github/` : "ghcr.io/",
  };
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

  // Helper to get common model template variables
  const getModelVars = () => {
    const { EKS_MODE } = process.env;
    const imagePrefixes = getImagePrefixes();
    return {
      KARPENTER_PREFIX: EKS_MODE === "auto" ? "eks.amazonaws.com" : "karpenter.k8s.aws",
      ...imagePrefixes,
    };
  };

  const updateModels = async (models, categoryDir, componentDir) => {
    await setK8sContext();
    const MODELS_DIR = path.join(COMPONENTS_DIR, categoryDir, componentDir);
    const modelVars = getModelVars();
    for (const model of models) {
      const modelTemplatePath = path.join(MODELS_DIR, `model-${model.name}.template.yaml`);
      const modelRenderedPath = path.join(MODELS_DIR, `model-${model.name}.rendered.yaml`);
      renderTemplate(modelTemplatePath, modelRenderedPath, modelVars);
      if (model.deploy) {
        await $`kubectl apply -f ${modelRenderedPath}`;
      } else {
        await $`kubectl delete -f ${modelRenderedPath} --ignore-not-found`;
      }
    }
  };

  const addModels = async (models, categoryDir, componentDir) => {
    await setK8sContext();
    const MODELS_DIR = path.join(COMPONENTS_DIR, categoryDir, componentDir);
    const modelVars = getModelVars();
    for (const model of models) {
      if (!model.deploy) {
        continue;
      }
      const modelTemplatePath = path.join(MODELS_DIR, `model-${model.name}.template.yaml`);
      const modelRenderedPath = path.join(MODELS_DIR, `model-${model.name}.rendered.yaml`);
      renderTemplate(modelTemplatePath, modelRenderedPath, modelVars);
      await $`kubectl apply -f ${modelRenderedPath}`;
    }
  };

  const removeAllModels = async (models, categoryDir, componentDir) => {
    await setK8sContext();
    const MODELS_DIR = path.join(COMPONENTS_DIR, categoryDir, componentDir);
    const modelVars = getModelVars();
    for (const model of models) {
      const modelTemplatePath = path.join(MODELS_DIR, `model-${model.name}.template.yaml`);
      const modelRenderedPath = path.join(MODELS_DIR, `model-${model.name}.rendered.yaml`);
      renderTemplate(modelTemplatePath, modelRenderedPath, modelVars);
      await $`kubectl delete -f ${modelRenderedPath} --ignore-not-found`;
    }
  };
  return { configureModels, updateModels, addModels, removeAllModels };
})();

// Terraform
const terraform = (function () {
  const setupWorkspace = async function (TERRAFORM_DIR, options = {}) {
    const requiredEnvVars = ["REGION", "EKS_CLUSTER_NAME", "EKS_MODE"];
    checkRequiredEnvVars(requiredEnvVars);
    const { REGION, EKS_CLUSTER_NAME, EKS_MODE, DOMAIN } = process.env;
    try {
      cd(TERRAFORM_DIR);
      // Only render eks.tf.template if it exists (main infra only)
      const templatePath = `${TERRAFORM_DIR}/eks.tf.template`;
      if (fs.existsSync(templatePath)) {
        renderTemplate(templatePath, `${TERRAFORM_DIR}/eks.tf`, { EKS_MODE });
      }
      await $`terraform init`;
      await $`terraform workspace new ${REGION}`;
    } catch (error) {}
    try {
      cd(TERRAFORM_DIR);
      await $`mkdir -p workspaces/${REGION}`;
      let content = `region = "${REGION}"\n` + `name = "${EKS_CLUSTER_NAME}"\n` + `domain = "${DOMAIN}"\n`;
      const addVars = (vars) => {
        for (const [key, value] of Object.entries(vars)) {
          if (Array.isArray(value)) {
            content += `${key} = ${JSON.stringify(value)}\n`;
          } else if (typeof value === "boolean") {
            content += `${key} = ${value}\n`;
          } else {
            content += `${key} = "${value}"\n`;
          }
        }
      };
      addVars(config.terraform.vars);
      if (!!options.vars) {
        addVars(options.vars);
      }
      fs.writeFileSync(`workspaces/${REGION}/terraform.tfvars`, content);
      await $`terraform workspace select ${REGION}`;
    } catch (error) {
      throw new Error(error);
    }
  };

  const plan = async function (TERRAFORM_DIR, options = {}) {
    const { REGION } = process.env;
    try {
      await setupWorkspace(TERRAFORM_DIR, options);
      await $`terraform plan --var-file="workspaces/${REGION}/terraform.tfvars"`;
    } catch (error) {
      throw new Error(error);
    }
  };

  const apply = async function (TERRAFORM_DIR, options = {}) {
    const { REGION } = process.env;
    try {
      await setupWorkspace(TERRAFORM_DIR, options);
      await $`terraform apply --var-file="workspaces/${REGION}/terraform.tfvars" --auto-approve`;
    } catch (error) {
      throw new Error(error);
    }
  };

  const destroy = async function (TERRAFORM_DIR, options = {}) {
    const { REGION } = process.env;
    try {
      await setupWorkspace(TERRAFORM_DIR, options);
      await $`terraform destroy --var-file="workspaces/${REGION}/terraform.tfvars" --auto-approve`;
    } catch (error) {
      throw new Error(error);
    }
  };

  const output = async function (TERRAFORM_DIR, options = {}) {
    try {
      await setupWorkspace(TERRAFORM_DIR, options);
      if (options.outputName) {
        const result = await $`terraform output -raw ${options.outputName}`;
        return result.stdout;
      } else {
        const result = await $`terraform output -json`;
        return JSON.parse(result.stdout);
      }
    } catch (error) {
      throw new Error(error);
    }
  };

  const applyWithRetry = async (TERRAFORM_DIR, maxAttempts = 3) => {
    let attempts = 0;
    let success = false;
    // await setK8sContext();
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

// Standard Mode Cleanup
const cleanupStandardModeResources = async () => {
  try {
    await setK8sContext();
  } catch {
    return; // Skip if cluster unreachable
  }

  const { EKS_CLUSTER_NAME, REGION } = process.env;

  // Fire-and-forget cleanup
  $`kubectl delete ingress --all --all-namespaces --ignore-not-found`.catch(() => {});
  $`kubectl delete nodepools --all --ignore-not-found`.catch(() => {});
  $`kubectl delete nodeclaims --all --ignore-not-found`.catch(() => {});

  if (EKS_CLUSTER_NAME && REGION) {
    $`aws ec2 describe-instances \
      --region ${REGION} \
      --filters "Name=tag:karpenter.sh/discovery,Values=${EKS_CLUSTER_NAME}" \
                "Name=instance-state-name,Values=running,pending,stopping,stopped" \
      --query "Reservations[].Instances[].InstanceId" \
      --output text | xargs -r aws ec2 terminate-instances --region ${REGION} --instance-ids`.catch(() => {});
  }

  await new Promise((resolve) => setTimeout(resolve, 5000));
};

export default {
  init,
  checkRequiredEnvVars,
  setK8sContext,
  renderTemplate,
  getImagePrefixes,
  model,
  terraform,
  cleanupStandardModeResources,
};
