#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = require("aws-cdk-lib");
const pipeline_stack_1 = require("../lib/stacks/pipeline-stack");
const config_1 = require("../lib/config");
const app = new cdk.App();
new pipeline_stack_1.PipelineStack(app, 'SwflcodersPipelineStack', {
    env: {
        account: config_1.PIPELINE_ACCOUNT,
        region: 'us-east-1',
    },
});
app.synth();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGlwZWxpbmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJwaXBlbGluZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSxtQ0FBbUM7QUFDbkMsaUVBQTZEO0FBQzdELDBDQUFpRDtBQUVqRCxNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztBQUMxQixJQUFJLDhCQUFhLENBQUMsR0FBRyxFQUFFLHlCQUF5QixFQUFFO0lBQ2hELEdBQUcsRUFBRTtRQUNILE9BQU8sRUFBRSx5QkFBZ0I7UUFDekIsTUFBTSxFQUFFLFdBQVc7S0FDcEI7Q0FDRixDQUFDLENBQUM7QUFDSCxHQUFHLENBQUMsS0FBSyxFQUFFLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIjIS91c3IvYmluL2VudiBub2RlXG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgUGlwZWxpbmVTdGFjayB9IGZyb20gJy4uL2xpYi9zdGFja3MvcGlwZWxpbmUtc3RhY2snO1xuaW1wb3J0IHsgUElQRUxJTkVfQUNDT1VOVCB9IGZyb20gJy4uL2xpYi9jb25maWcnO1xuXG5jb25zdCBhcHAgPSBuZXcgY2RrLkFwcCgpO1xubmV3IFBpcGVsaW5lU3RhY2soYXBwLCAnU3dmbGNvZGVyc1BpcGVsaW5lU3RhY2snLCB7XG4gIGVudjoge1xuICAgIGFjY291bnQ6IFBJUEVMSU5FX0FDQ09VTlQsXG4gICAgcmVnaW9uOiAndXMtZWFzdC0xJyxcbiAgfSxcbn0pO1xuYXBwLnN5bnRoKCk7XG4iXX0=