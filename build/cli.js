#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const yargs_1 = __importDefault(require("yargs"));
const helpers_1 = require("yargs/helpers");
const _1 = require("./commands/*");
(0, yargs_1.default)((0, helpers_1.hideBin)(process.argv))
    .scriptName("papapackage")
    .commandDir("commands")
    .command("*", "The default command", () => { }, _1.handler)
    .alias({ h: "help" }).argv;