// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
const express = require('express');
const app = express();
const port = Number(process.env.PORT || '3000');
const AWSXRay = require('aws-xray-sdk');

AWSXRay.captureHTTPsGlobal(require('http'));
AWSXRay.captureHTTPsGlobal(require('https'));
AWSXRay.capturePromise();

app.use(AWSXRay.express.openSegment('serviceB_v2'));
app.use(express.json());

app.get('/health', async (req, res) => {
  res.status(200).end();
});

app.get('/version', async (req, res) => {
  res.json({ version: 'v2' });
});

app.use(AWSXRay.express.closeSegment());

app.listen(port, () => {
  console.log(`start listening on ${port}`);
});
