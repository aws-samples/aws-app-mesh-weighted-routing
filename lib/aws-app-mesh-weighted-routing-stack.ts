// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as cloudmap from '@aws-cdk/aws-servicediscovery';
import * as appmesh from '@aws-cdk/aws-appmesh';
import * as route53 from '@aws-cdk/aws-route53';
import { AppMeshService } from './app-mesh-service';

// This class is a main stack of this project.
// It will deploy environments (like Amazon VPC, AWS App Mesh...) and its services.
export class AwsAppmeshWeightedRoutingStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a Amazon VPC.
    const vpc = new ec2.Vpc(this, 'VPC', { maxAzs: 2 });

    // Create a Mesh of AWS App Mesh.
    const mesh = new appmesh.Mesh(this, 'Mesh');

    // Create a AWS Cloud Map private dns namespace.
    // It also creates a Amazon Route53 hosted zone.
    // This namespace is used to find the actual nodes of each VirtualNode.
    const namespace = new cloudmap.PrivateDnsNamespace(this, 'namespace', {
      name: 'cloudmap.local',
      vpc,
    });

    // Create a Amazon ECS cluster within the VPC.
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc });

    // Create a Amazon Route53 hosted zone.
    // It's separated from the hosted zone created above.
    // This hosted zone is used to avoid a IP address lookup error.
    const hostedZone = new route53.PrivateHostedZone(this, 'PrivateHostedZone', {
      zoneName: 'appmesh.local',
      vpc,
    });

    // Common properties to be used in the below.
    const environment = { mesh, namespace, cluster, hostedZone };

    // Create a service A.
    // The service only has a VirtualNode to be routed.
    // 100% of the inbound traffic will be routed to the node.
    const serviceA = new AppMeshService(this, 'AppMeshServiceA', {
      name: 'serviceA',
      port: 3000,
      routes: [{
        name: 'serviceA',
        weight: 1,
      }],
      environment,
    });

    // Create a service B.
    // The service has two nodes; version 1 and version 2.
    // 80% of inbound traffic will be routed to the version 1 and
    // 40% of the traffic will be routed to the version 2.
    const serviceB = new AppMeshService(this, 'AppMeshServiceB', {
      name: 'serviceB',
      port: 3000,
      routes: [
        {
          name: 'serviceB_v1',
          weight: 4,
        },
        {
          name: 'serviceB_v2',
          weight: 1,
        },
      ],
      environment,
    });

    // Add service B as a backend of service A to be accessible from service A to service B.
    serviceA.addBackends(serviceB);

    // Add external load balancer to the fargate service of service A.
    serviceA.envoyFargateServices[0].createExternalLoadBalancer();
  }
}
