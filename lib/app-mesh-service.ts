// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as cloudmap from '@aws-cdk/aws-servicediscovery';
import * as appmesh from '@aws-cdk/aws-appmesh';
import * as route53 from '@aws-cdk/aws-route53';
import { EnvoyFargateService } from './envoy-fargate-service';

interface AppMeshServiceProps {
  name: string;
  port: number;
  routes: AppMeshRoute[];
  environment: AppEnvironment;
}

interface AppMeshRoute {
  name: string;
  weight: number;
}

interface AppEnvironment {
  mesh: appmesh.Mesh;
  cluster: ecs.Cluster;
  namespace: cloudmap.PrivateDnsNamespace;
  hostedZone: route53.PrivateHostedZone;
}

// This class represents the App Mesh service.
// It might contains multiple fargate services.
// It creates a VirtualService and VirtualRoute to the services.
export class AppMeshService extends cdk.Construct {
  public readonly envoyFargateServices: EnvoyFargateService[];
  public readonly virtualService: appmesh.VirtualService;

  constructor(scope: cdk.Construct, id: string, props: AppMeshServiceProps) {
    super(scope, id);

    // Create EnvoyFargateServices.
    this.envoyFargateServices = props.routes.map(r => {
      return new EnvoyFargateService(this, `EnvoyFargateService_${r.name}`, {
        meta: { name: r.name, port: props.port },
        environment: props.environment,
      });
    });

    // Create a VirtualRouter.
    const virtualRouter = new appmesh.VirtualRouter(this, `VirtualRouter_${props.name}`, {
      mesh: props.environment.mesh,
      listeners: [appmesh.VirtualRouterListener.http(props.port)],
    });

    // Create weighted targets.
    const weightedTargets = this.envoyFargateServices.map((s, idx) => {
      return {
        virtualNode: s.virtualNode,
        weight: props.routes[idx].weight,
      };
    });

    // Create a VirtualRouter
    virtualRouter.addRoute('VirtualRoute', {
      routeName: `Route_${props.name}`,
      routeSpec: appmesh.RouteSpec.http({ weightedTargets }),
    });

    // Create a VirtualService.
    this.virtualService = new appmesh.VirtualService(this, `VirtualService_${props.name}`, {
      virtualServiceName: `${props.name}.${props.environment.hostedZone.zoneName}`.toLowerCase(),
      virtualServiceProvider: appmesh.VirtualServiceProvider.virtualRouter(virtualRouter),
    });

    // Create an A record to the hosted zone to avoid the IP address lookup error.
    // https://docs.aws.amazon.com/app-mesh/latest/userguide/troubleshoot-connectivity.html
    new route53.ARecord(this, `ARecord_${props.name}`, {
      zone: props.environment.hostedZone,
      recordName: `${props.name}.${props.environment.hostedZone.zoneName}`.toLowerCase(),
      target: route53.RecordTarget.fromIpAddresses('10.10.10.10'),
    });
  }

  // Add other AppMeshService a backend.
  addBackends(service: AppMeshService): void {
    this.envoyFargateServices.forEach(from => {
      from.virtualNode.addBackend(appmesh.Backend.virtualService(service.virtualService));

      service.envoyFargateServices.forEach(to => {
        from.fargateService.connections.allowTo(
          to.fargateService, ec2.Port.tcp(to.meta.port),
          `Allow inbound traffic from ${from.meta.name} to ${to.meta.name} (TCP ${to.meta.port})`,
        );
      });
    });
  }
}
