---
title: "At AWS Event"
weight: 14
---

# At AWS Event

Welcome to the workshop! Your GenAI infrastructure has been pre-deployed by the event organizers. Let's get you connected to your workshop environment and verify everything is ready for an amazing learning experience.

## 🎯 What's Already Done

::alert[**Good news!** The complex infrastructure deployment is already complete. You can focus entirely on learning and building!]{type="success"}

Your workshop environment includes:
- ✅ **EKS cluster** with Auto Mode enabled
- ✅ **GenAI platform** components (vLLM, LiteLLM, Langfuse, Open WebUI)
- ✅ **Pre-loaded models** (Llama 3.1, Qwen3)
- ✅ **Specialized hardware** (Neuron nodes for inference)
- ✅ **Observability stack** configured and running

## 📝 Step 1: Access Workshop Studio

Workshop Studio provides your isolated AWS environment for this event.

### 1.1 Connect to Workshop Studio

Navigate to the event URL provided by your instructor. If access code provided, enter your access code at this link:

```
https://catalog.workshops.aws/join
```

You'll see the Workshop Studio landing page:

![Workshop Studio Event Page](/static/workshopstudio-event1.jpg)

### 1.2 Sign In with Email OTP

Click **Email One-Time Password (OTP)** to proceed with passwordless authentication:

1. **Enter your email address**
2. Click **Send passcode**
3. Check your email for subject: **"Your one-time passcode"**
4. Enter the code
5. Click **Sign in**

::alert[**Tip**: The passcode expires in 10 minutes. If it expires, simply request a new one.]{type="info"}

### 1.3 Join the Event

After signing in, you'll see the event access page:

1. The **Event access code** should be pre-filled. Click **Next**.
2. Check ✅ **"I agree with the Terms and Conditions"**
   ![Workshop Studio Event Page](/static/workshopstudio-event3.jpg)
3. Click **Join event**

You're now in your workshop environment!

## 🖥️ Step 2: Access Your AWS Account

### 2.1 Open AWS Console

In the Workshop Studio left sidebar, locate and click:

**🔧 Open AWS Console**

This opens the AWS Management Console in a new tab with temporary credentials already configured.

::alert[**Important**: Use this specific console link. Do not use your personal AWS account for this workshop.]{type="warning"}

## 💻 Step 3: Access Your Development Environment

### 3.1 Open Visual Studio Code (VSC) IDE

Back in your Workshop Studio:

1. Look for **URL** in the **Event Outputs** section
2. Click the URL to open a VSC IDE in a new tab
3. You now have a full development environment with:
   - Terminal access
   - kubectl pre-configured
   - AWS CLI ready to use
   - Code editor for later exercises

### 3.2 Verify kubectl Access

In the VSC terminal, verify your connection to the EKS cluster:

:::code{language=bash showCopyAction=true}
# Check cluster access
kubectl cluster-info

# Expected output:
# Kubernetes control plane is running at https://...
:::

## 🎉 Setup Complete!

Congratulations! You now have access to:

✅ **AWS Console** with temporary credentials

✅ **VSC IDE** with terminal and kubectl configured

✅ **EKS cluster** connection verified

## 🚀 What's Next?

Now that you have access to your development environment, let's explore the GenAI infrastructure that's been deployed for you and verify everything is working correctly.

---

**[Continue to Infrastructure Overview →](/introduction/infra-setup/)**
