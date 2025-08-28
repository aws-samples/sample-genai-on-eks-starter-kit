---
title: "Running the Application"
date: 2025-08-13T11:05:19-07:00
weight: 350
draft: true
---

All is left to deploy this application and test it out.

### Pre-requisite

From module 2, validate that you can access your AI Gateway and the LangFuse observability dashboard.

### Deploy Application Components

We are going to store the application code files in ConfigMaps. First create the configmaps for the application code by running the following scripts. You can see this script at ['create-configmaps.sh'](../../static/code/module3/credit-validation/create-configmaps.sh)

```bash
./create-configmaps.sh
```

Using the file ['agentic-application-deploy.yaml'](../../static/code/module3/credit-validation/agentic-application-deployment.yaml) to deploy the application components onto the EKS. You can use the following command.

```bash
kubectl create -f deployment.yaml
```

Check of all the components are deployed and in the running state using the list of pods following command.

```bash
kubectl get pods
```

### Calling the application

Before calling the application, tail the log from application pod in a separate terminal using the following command.

```bash
kubectl logs -f <POD_NAME>
```

The [loan application](../../static/code/module3/credit-validation/example1.png) is an example loan application. You will use this file to make a call to the agentic application. Use the following command.

```bash
curl -X POST -F "file=@../../static/code/module3/credit-validation/example1.png" http://<YOUR APPLICATION URL>/loan
```

Track the logs from the application pod and see how the LLM is executing the workflow. Remember that you have not coded any workflow or calls to MCP servers. All is done for you by the LLM using the prompt that you have provided.

### Validating in LangFuse

Go to LangFuse page and open the Traces section. Find our your agent call, you can get the identity of your call by opening up the [`credit-underwriting-agent.py`](../../static/code/module3/credit-validation/credit-underwriting-agent.py) and look for the string `run_name` which is a LangFuse pointer to record your traces against.

You shall see a flow similar to the picture below with the `run_name` key captured in a red rectangle. Notice that how a full trace with multiple calls to your tool and LLM are captured. Validate following:

- The flow has been executed as per your prompt
- See the input and out of each LLM and MCP calls and familiarise yourself with the data captured
- See the Metrics for LLM such as Time to First Token and LAtency capture by the LangFuse.

![LangFuse](../../static/images/module-3/LoanBuddy-Observability.png)
*Observability*