# AWS App Mesh Weighted Routing

This project provides a weighted routing implementation by AWS CDK, AWS App Mesh, and Amazon ECS.
This project deploys two services.
- Service A: A gateway service that accept all inbound traffic. At `/serviceb` endpoint, it calls `/version` endpoint of the service B and returns the result to the client.
- Service B: Two different versions exist for this service. At `/version` endpoint, version 1 returns `{"version": "v1"}` and version 2 returns `{"version": "v2"}`.

Note that this project focuses on "How to construct a minimum example for weighted routing on AWS App Mesh by using AWS CDK".
To make it simple, we separate the directories for each version of service B. (See [/containers](/containers).)
That isn't best practice from the aspect of the DevOps.
You should manage the version by git, docker tags, and Amazon ECR tags for your production workload.

## Architecture

![](/imgs/arch.png)

## Deployment

Before the deployment, read [Getting Started](https://docs.aws.amazon.com/cdk/latest/guide/getting_started.html) guide of AWS CDK.
After setting up the environment, execute a command below.

```bash
cdk deploy
```

You can confirm the API endpoint as an output of the deployment.
The url will be used in the following steps.

## Check the API

At the previous step, you deployed a service A and 2 versions of service B.

The traffic from service A to service B is weighted, that is, 80% of the traffic is routed to version 1 of service B and the other traffic is routed to the version 2.
Let's check the behavior.

The stack creates an API endpoint of service A.
You can confirm it at the output of the deployment.
It may take minutes to make the endpoint healthy.
```bash
# Replace <API_ID> and <REGION>
curl -v http://<API_ID>.<REGION>.elb.amazonaws.com/serviceb
```

The result should be below.
Execute the command multiple times to check that there are two different results sent from service B.
```bash
{ "serviceB": { "version": "v1" } }
# or
{ "serviceB": { "version": "v2" } }
```

Let's see how the traffic is routed on [AWS X-Ray console](https://console.aws.amazon.com/xray/home).
You can confirm the traffic was weighted in the service map.

![](/imgs/servicemap.png)

## Clean

Delete the stack by a command below.

```bash
cdk destroy
```

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
