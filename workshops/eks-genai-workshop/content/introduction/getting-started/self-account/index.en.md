---
title : "Using your account"
weight : 16
---

You will spin up an already built website, API end point, and media stream. In this lab, you'll use a CloudFormation template to launch the web application.

### Step 1. Deploy the CloudFormation Stacks

#### Download the CloudFormation templates
You will run **curl** command in your command line interface, so check whether your OS already has curl installed. Mac OS and Linux OS usually has curl command installed. For Windows 10, you can use curl (located in \windows\system32) in command prompt, or use Windows Subsystem for Linux.  

::alert[Amazon Linux on Amazon EC2 or AWS CloudShell does have curl installed, however using curl on AWS region resource will yield incorrect performance measurement of CloudFront, since AWS regions and CloudFront Edge Locations are connected to AWS Global Network.]{type="warning"}



```bash
curl -o setup-cf-with-cdk.yaml "https://ws-assets-prod-iad-r-iad-ed304a55c2ca1aee.s3.us-east-1.amazonaws.com/f3269cf5-aacf-4149-abd0-917622b2fc9e/setup-cf-with-cdk.yaml"
curl -o vscode-server.yaml "https://ws-assets-prod-iad-r-iad-ed304a55c2ca1aee.s3.us-east-1.amazonaws.com/f3269cf5-aacf-4149-abd0-917622b2fc9e/vscode-server.yaml"
```

Launch the CloudFormation stack in **the us-east-1 N. Virginia Region**. The setup-cf-with-cdk template will create the following resources:
- An API gateway with Lambda functions
- IAM roles that Lambda functions will assume
- S3 buckets with web page
- MediaPackage for stream

The vscode-server template will create the following resources:
- EC2 Instance that hosts Visual Studio Code Server (VSCS)
- CloudFront Distribution to access VSCS

:::alert{type="warning"}
Please remember to clean up the resources after the workshop to avoid any unnecessary costs. Go to the [Conclusion and Cleanup](/Setting-up-CloudFront/conclusion) section to cleanup.
:::

#### Deploy setup-cf-with-cdk.yaml

| Region | Launch Template |
|------- | -------- |
| N. Virginia (us-east-1) | :button[Deploy to N. Virginia]{iconName="external" iconAlign="right" href="https://console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/new?stackName=cloudfront-foundation-i"} |

The link will automatically bring you to the CloudFormation dashboard and start the stack creation process in the specified region. In **Template source,** choose *Upload a template file* and upload the file you just downloaded (setup-cf-with-cdk.yaml), enter *setup-cf-with-cdk* as stack name, proceed through the wizard to launch the stack. Leave all options at their default values, but make sure to check the box to allow CloudFormation to create IAM roles on your behalf:

![Create Stack](/static/Setup-CloudFront-using-CDK/Preparation/Using-your-account/create-stack.png)

Name your stack *setup-cf-with-cdk* and input **content-acceleration-cloudfront-workshop-aws-asset** in  **AssetsBucketName** Parammeter and Leave the **AssetsBucketPrefix** blank 
![Stack Details](/static/Setup-CloudFront-using-CDK/Preparation/Using-your-account/stack-details.png)

Click Next

Keep all of the defaults **Configure stack options** menu

Click Next

Accept the Acknowlegment that AWS CloudFormation might create IAM resources

![IAM Role](/static/Setup-CloudFront-using-CDK/Preparation/Using-your-account/iam-role.png)

After you click on **Submit**, and please wait for the stack to show **CREATE_COMPLETE** in green under status, it takes about 3 minutes for the stack to be created.

#### Deploy vscode-server.yaml

| Region | Launch Template |
|------- | -------- |
| N. Virginia (us-east-1) | :button[Deploy to N. Virginia]{iconName="external" iconAlign="right" href="https://console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/new?stackName=cloudfront-foundation-i"} |

The link will automatically bring you to the CloudFormation dashboard and start the stack creation process in the specified region. In **Template source,** choose *Upload a template file* and upload the file you just downloaded (vscode-server.yaml) , enter *vscode-server* as stack name, proceed through the wizard to launch the stack. Leave all options at their default values, but make sure to check the box to allow CloudFormation to create IAM roles on your behalf.


### Step 2. Check Stack Outputs

1. Go to the AWS Console and Navigate to setup-cf-with-cdk (CloudFormation > Stacks > setup-cf-with-cdk) and check the Outputs tab.

Take note of the following Outputs, API GW Endpoint, S3 Origin Bucket, Media Package endpoint and the S3 Website domain:

- apiOriginEndPoint
- originBucket
- videoOriginDomain
- s3WebsiteDomain

2. Go to the AWS Console and Navigate to vscode-server (CloudFormation > Stacks > vscode-server) and check the Outputs tab.

Take note of the following Outputs:

- Password
- URL

![Stack Outputs](/static/vsc-stack.png)


### Step 3. Setup VSC IDE

This workshop uses Microsoft Visual Studio Code Server (VSCS) as an integrated development environment (IDE). 

From our last step locate the **URL** field and copy the URL. Open this URL in a new browser tab. You will be prompted to enter a password.  

Enter the value from the **Password** field (found in the Event Outputs) to access the IDE.  

![Password](/static/vsc-password.png)

Once the IDE has loaded, you will see the terminal where you can execute commands for the labs.

![IDE-Loaded](/static/vsc.png)

You are now ready to proceed to the next section of the lab.

