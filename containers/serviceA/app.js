// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
const express = require('express');
const app = express();
const port = Number(process.env.PORT || '3000');
const AWSXRay = require('aws-xray-sdk');

AWSXRay.captureHTTPsGlobal(require('http'));
AWSXRay.captureHTTPsGlobal(require('https'));
AWSXRay.capturePromise();

const axios = require('axios');

app.use(AWSXRay.express.openSegment('serviceA'));
app.use(express.json());

app.get('/health', async (req, res) => {
  res.status(200).end();
});

app.get('/serviceb', async (req, res) => {
  try {
    const resp = await axios.get('http://serviceb.appmesh.local:3000/version');

    res.json({ serviceB: resp.data });
  } catch (e) {
    console.error(e);
    res.json({ error: JSON.stringify(e) });
  }
});

app.use(AWSXRay.express.closeSegment());

app.listen(port, () => {
  console.log(`start listening on ${port}`);
});
