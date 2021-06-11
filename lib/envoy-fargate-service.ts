// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as cloudmap from '@aws-cdk/aws-servicediscovery';
import * as appmesh from '@aws-cdk/aws-appmesh';
import * as route53 from '@aws-cdk/aws-route53';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import * as path from 'path';

const ENVOY_CONTAINER = 'public.ecr.aws/appmesh/aws-appmesh-envoy:v1.17.2.0-prod';
const XRAY_CONTAINER = 'amazon/aws-xray-daemon:3.3.2';

interface AppMeta {
  name: string;
  port: number;
}

interface AppEnvironment {
  mesh: appmesh.Mesh;
  cluster: ecs.Cluster;
  namespace: cloudmap.PrivateDnsNamespace;
  hostedZone: route53.PrivateHostedZone;
}

interface EnvoyFargateServiceProps {
  meta: AppMeta;
  environment: AppEnvironment;
}

// This class contains a Amazon ECS Fargate service and its VirtualNode.
// The Fargate service contains Envoy and AWS X-Ray sidecars.
export class EnvoyFargateService extends cdk.Construct {
  public readonly meta: AppMeta;
  public readonly environment: AppEnvironment;
  public readonly fargateService: ecs.FargateService;
  public readonly virtualNode: appmesh.VirtualNode;

  constructor(scope: cdk.Construct, id: string, props: EnvoyFargateServiceProps) {
    super(scope, id);

    this.meta = props.meta;
    this.environment = props.environment;

    // Create a basic task definition
    const taskDefinition = this.createTaskDefinition();

    // Add an app container to the task definition.
    const appContainer = this.addAppContainer(taskDefinition);

    // Add an envoy container to the task definition.
    this.addEnvoyContainer(taskDefinition, props);

    // Add a AWS X-Ray container to the task definition.
    this.addXRayContainer(taskDefinition);

    // Create a Fargate service.
    this.fargateService = this.createFargateService(props, taskDefinition, appContainer);

    // Create a VirtualNode.
    this.virtualNode = this.createVirtualNode(props, this.fargateService);
  }

  // Create a taskrole.
  // It allows to access to the AWS App Mesh, Amazon CloudWatch, and AWS X-Ray daemon.
  createTaskRole(): iam.Role {
    return new iam.Role(this, `TaskRole_${this.meta.name}`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AWSAppMeshEnvoyAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLogsFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'),
      ],
    });
  }

  // Create an execution role.
  createExecutionRole(): iam.Role {
    return new iam.Role(this, `TaskExecutionRole_${this.meta.name}`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
      ],
    });
  }

  // Create a task definition.
  // It contains proxy configuration for the envoy sidecar.
  createTaskDefinition(): ecs.FargateTaskDefinition {
    const taskRole = this.createTaskRole();
    const executionRole = this.createExecutionRole();

    return new ecs.FargateTaskDefinition(this, `TaskDefinition_${this.meta.name}`, {
      taskRole,
      executionRole,
      proxyConfiguration: new ecs.AppMeshProxyConfiguration({
        containerName: 'envoy',
        properties: {
          appPorts: [this.meta.port],
          proxyEgressPort: 15001,
          proxyIngressPort: 15000,
          ignoredUID: 1337,
          egressIgnoredIPs: [
            '169.254.170.2',
            '169.254.169.254',
          ],
        },
      }),
    });
  }

  // Add an app container to the task definition.
  addAppContainer(taskDefinition: ecs.FargateTaskDefinition): ecs.ContainerDefinition {
    const appContainer = taskDefinition.addContainer(`AppContainer_${this.meta.name}`, {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, '..', 'containers', this.meta.name)),
      essential: true,
      healthCheck: {
        command: [
          'CMD-SHELL',
          `curl -s http://localhost:${this.meta.port}/health`,
        ],
        startPeriod: cdk.Duration.seconds(10),
        interval: cdk.Duration.seconds(5),
        timeout: cdk.Duration.seconds(2),
        retries: 3
      },
      logging: new ecs.AwsLogDriver({
        streamPrefix: this.meta.name,
      }),
    });

    appContainer.addPortMappings({
      containerPort: this.meta.port,
      hostPort: this.meta.port,
      protocol: ecs.Protocol.TCP,
    });

    return appContainer;
  }

  // Add an envoy container to the task definition.
  addEnvoyContainer(
    taskDefinition: ecs.FargateTaskDefinition,
    props: EnvoyFargateServiceProps
  ): ecs.ContainerDefinition {
    const envoyContainer = taskDefinition.addContainer(`EnvoyContainer_${this.meta.name}`, {
      containerName: 'envoy',
      image: ecs.ContainerImage.fromRegistry(ENVOY_CONTAINER),
      essential: true,
      environment: {
        APPMESH_VIRTUAL_NODE_NAME: `mesh/${this.environment.mesh.meshName}/virtualNode/${this.meta.name}`,
        AWS_REGION: cdk.Stack.of(this).region,
      },
      healthCheck: {
        command: [
          'CMD-SHELL',
          'curl -s http://localhost:9901/server_info | grep state | grep -q LIVE'
        ],
        startPeriod: cdk.Duration.seconds(10),
        interval: cdk.Duration.seconds(5),
        timeout: cdk.Duration.seconds(2), 
        retries: 3
      },
      memoryLimitMiB: 128,
      user: '1337',
      logging: new ecs.AwsLogDriver({
        streamPrefix: `${this.meta.name}_envoy`,
      }),
    });

    return envoyContainer;
  }

  // Add an AWS X-Ray container to the task definition.
  addXRayContainer(taskDefinition: ecs.FargateTaskDefinition): ecs.ContainerDefinition {
    const xrayContainer = taskDefinition.addContainer(`XRayContainer_${this.meta.name}`, {
      containerName: 'xray',
      image: ecs.ContainerImage.fromRegistry(XRAY_CONTAINER),
      essential: true,
      logging: new ecs.AwsLogDriver({
        streamPrefix: `${this.meta.name}_xray`,
      }),
    });

    xrayContainer.addPortMappings({
      containerPort: 2000,
      hostPort: 2000,
      protocol: ecs.Protocol.UDP,
    });

    return xrayContainer;
  }

  // Create an Amazon ECS Fargate service.
  createFargateService(
    props: EnvoyFargateServiceProps,
    taskDefinition: ecs.TaskDefinition,
    appContainer: ecs.ContainerDefinition,
  ): ecs.FargateService {
    return new ecs.FargateService(this, `FargateService_${this.meta.name}`, {
      cluster: this.environment.cluster,
      taskDefinition,
      desiredCount: 1,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE,
      },
      cloudMapOptions: {
        cloudMapNamespace: this.environment.namespace,
        container: appContainer,
        dnsRecordType: cloudmap.DnsRecordType.A,
        dnsTtl: cdk.Duration.minutes(0),
        name: this.meta.name,
      },
    });
  }

  // Create a VirtualNode for the Fargate service.
  createVirtualNode(
    props: EnvoyFargateServiceProps,
    fargateService: ecs.FargateService
  ): appmesh.VirtualNode {
    return new appmesh.VirtualNode(this, `VirtualNode_${this.meta.name}`, {
      mesh: this.environment.mesh,
      virtualNodeName: this.meta.name,
      serviceDiscovery: appmesh.ServiceDiscovery.cloudMap({
        service: fargateService.cloudMapService!,
      }),
      listeners: [
        appmesh.VirtualNodeListener.http({
          port: this.meta.port,
          healthCheck: appmesh.HealthCheck.http({
            healthyThreshold: 3,
            interval: cdk.Duration.seconds(5),
            path: '/health',
            timeout: cdk.Duration.seconds(2),
            unhealthyThreshold: 2,
          }),
        }),
      ],
      accessLog: appmesh.AccessLog.fromFilePath('/dev/stdout'),
    });
  }

  // Create an external load balancer so that make it accessible.
  createExternalLoadBalancer(): void {
    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, `ApplicationLoadBalancer_${this.meta.name}`, {
      internetFacing: true,
      vpc: this.environment.cluster.vpc,
    });

    const listener = loadBalancer.addListener(`Listener_${this.meta.name}`, {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
    });
    
    const targetGroup = listener.addTargets(`TargetGroup_${this.meta.name}`, {
      port: this.meta.port,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [this.fargateService],
      healthCheck: {
        path: '/health',
      },
    });
    
    new cdk.CfnOutput(this, `ApiEndpoint_${this.meta.name}`, {
      value: loadBalancer.loadBalancerDnsName,
    });
  }
}
