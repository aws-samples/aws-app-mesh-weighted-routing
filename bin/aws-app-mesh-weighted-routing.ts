#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { AwsAppmeshWeightedRoutingStack } from '../lib/aws-app-mesh-weighted-routing-stack';

const app = new cdk.App();
new AwsAppmeshWeightedRoutingStack(app, 'AwsAppmeshWeightedRoutingStack', {});
