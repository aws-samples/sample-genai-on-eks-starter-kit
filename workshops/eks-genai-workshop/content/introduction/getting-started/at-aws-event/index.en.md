---
title : "At AWS Event"
weight : 14
---

You start the lab with already built web site, API end point, and media stream. In this lab, you'll login to the AWS account provided for this workshop, and verify the deployed web application.

### Step 1. Login into Workshop Studio Event

To access the AWS account provided for this workshop, follow the instructions below.
1. You must obtain the sign-in URL from the event organizer. Connect to the event sign-in URL, and you will see below page. Click **Email One-Time Password (OTP)** button.
![Workshop studio Event page](/static/workshopstudio-event1.jpg)
1. Enter your email address and click **Send passcode**.
![Enter email](/static/EE3.jpg)
1. Check the subject **Your one-time passcode** email in your email box.
![Check the email](/static/EE4.jpg)
1. Copy the passcode and paste it as shown below, then press the **Sign in** button.
![Copy and paste the passcode](/static/EE5.jpg)
1. You will see event access code, which is already fill-in. Click **Next**.
![Event access code](/static/workshopstudio-event2.jpg)
1. Check the checkbox **I agree with the Terms and Conditions** and click **Join event**.
![Terms and Condition](/static/workshopstudio-event3.jpg)

### Step 2. Check setup-cf-with-cdk Outputs

1. In the left menu, click **Open AWS Console** button and the AWS Console will open in a new browser window.
![Open AWS Console](/static/workshopstudio-event4.png)
2. Go to the AWS Console and search for CloudFormation.
3. Check setup-cf-with-cdk Stack (CloudFormation > Stacks > setup-cf-with-cdk) and check the Outputs tab.

Take note of the following Outputs, API GW Endpoint, S3 Origin Bucket, Media Package endpoint and the S3 Website domain:

- apiOriginEndPoint
- originBucket
- s3WebsiteDomain
- videoOriginDomain



### Step 3. Setup VSC IDE

This workshop uses Microsoft Visual Studio Code Server (VSCS) as an integrated development environment (IDE). 

From the top left corner of the page, click on the workshop title to access the **Event Dashboard**. Once there, scroll down to the **Event Outputs** table. Locate the **URL** field and copy the URL. Open this URL in a new browser tab. You will be prompted to enter a password.  

![Event Outputs](/static/vscs-setup.png)

Enter the value from the **Password** field (found in the Event Outputs) to access the IDE.  

![Password](/static/vsc-password.png)

Once the IDE has loaded, you will see the terminal where you can execute commands for the labs.

![IDE-Loaded](/static/vsc.png)

You are now ready to proceed to the next section of the lab.