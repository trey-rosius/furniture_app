#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { FurnitureAppStack } from '../lib/furniture-app-stack';

const app = new cdk.App();
new FurnitureAppStack(app, 'FurnitureAppStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
});
