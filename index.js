
const core = require('@actions/core');
const github = require('@actions/github');
const exec = require("@actions/exec");
const fs = require('fs');
var path = require('path');

main();
function main() {
    const downloadExLibs = getAndSanitizeInputs('download-exotic-libraries', 'boolean', true);
    if (downloadExLibs === true) {
        downloadExoticLibraries(function(completed) {
            if (completed === true) {
                afterDownloadDeps();
            } else {
                core.setFailed("Failed to download exotic libraries");
                return;
            }
        });
    } else {
        afterDownloadDeps();
    }
}

function afterDownloadDeps() {
    const compilerOptsForTests = getAndSanitizeInputs('compiler-options-for-tests', 'flatten_string', '-pedantic');
    const runCesterRegression = getAndSanitizeInputs('run-cester-regression', 'boolean', true);
    const cesterOpts = getAndSanitizeInputs('cester-options', 'flatten_string', '--cester-noisolation --cester-nomemtest');
    const testFolders = getAndSanitizeInputs('test-folders', 'array', [ 'test/', 'tests/' ]);
    const testFilePatterns = getAndSanitizeInputs('test-file-pattern', 'array', [ '^test_', '_test[.c](c\+\+|cpp|c)' ]);
    const testExludeFilePatterns = getAndSanitizeInputs('test-exclude-file-pattern', 'array', [ 'mock+' ]);
    const selectedCompiler = getAndSanitizeInputs('the-matrix-compiler-internal-use-only', 'string', "");
    const selectedArch = formatArch(getAndSanitizeInputs('the-matrix-arch-internal-use-only', 'string', ""));
    
    var params = {
        numberOfFailedTests: 0,
        numberOfTests: 0
    }
    var outputName = "out";
    if (selectedCompiler.startsWith("clang") && process.platform.startsWith("windows")) {
        outputName = "out.exe";
    }
    if (runCesterRegression === true && selectedCompiler !== "" && selectedArch !== "") {
        console.log(`Test Folders ${testFolders} ~~ ` + (testFolders instanceof Array));
        testFolders.every(async function (folder, index) {
            if (!fs.existsSync(folder)) {
                core.setFailed("The test folder does not exist: " + folder);
                return false;
            }
            var files  = fs.readdirSync(folder);
            if (!files) {
              core.setFailed("Could not list the content of test folder: " + folder);
              return false;
            }
            files.every(async function (file, index) {
                var skip = true;
                testFilePatterns.every(function (pattern, index) {
                    if (new RegExp(pattern).test(file)) {
                        skip = false;
                        return false;
                    }
                });
                if (skip === true) { return true; }
                testExludeFilePatterns.every(function (pattern, index) {
                    if (new RegExp(pattern).test(file)) {
                        skip = true;
                        return false;
                    }
                });
                if (skip === true) { return true; }
                
                params.numberOfTests++;
                var fullPath = path.join(folder, file);
                var compiler = selectCompilerExec(selectedCompiler, file);
                console.log("Running test: " + fullPath);
                var command = `${compiler} ${selectedArch} ${compilerOptsForTests} ${fullPath} -o ${outputName}; ./${outputName} ${cesterOpts}`;
                try {
                    await exec.exec(command);
                } catch (error) {
                    console.error(error);
                    params.numberOfFailedTests++;
                    console.log("In " + params.numberOfFailedTests);
                }
                console.log("Done with " + file);
                
            });
        });
        if (fs.existsSync(outputName)) {
            exec.exec("rm " + outputName).then((result) => {
                console.log(result);
            }).catch((error) => {
                console.error(error);
            });
        }
        afterAll(params);
    }
}

function afterAll(params) {
    try {
        console.log("After All: " + params.numberOfFailedTests);
        if (params.numberOfFailedTests !== 0) {
            throw new Error("Regression test fails. Check the log above for details");
        }
        core.setOutput("tests-passed", (params.numberOfFailedTests === 0));
        core.setOutput("tests-count", params.numberOfTests);
        core.setOutput("failed-tests-count", params.numberOfFailedTests);
        core.setOutput("passed-tests-count", params.numberOfTests - params.numberOfFailedTests);

        // Get the JSON webhook payload for the event that triggered the workflow
        const payload = JSON.stringify(github.context.payload, undefined, 2)
        //console.log(`The event payload: ${payload}`);
    } catch (error) {
        core.setFailed(error.message);
    }
}


function getAndSanitizeInputs(key, type, defaultValue) {
    var value = core.getInput(key);
    if (!value || value == "") {
        return defaultValue;
    }
    if (type === "boolean") {
        return value.toUpperCase() === "TRUE" || value;
    }
    if (type === "flatten_string") {
        return value.split('\n').join(' ');
    }
    if (type === "array" && (typeof value == "string")) {
        return strToArray(value, '\n');
    }
    return value;
}

function strToArray(str, seperator) {
    return str.split(seperator);
}

function selectCompilerExec(selectedCompiler, file) {
    if (selectedCompiler.startsWith("gnu")) {
        return (file.endsWith('cpp') || file.endsWith('c++') ? "g++" : "gcc");
    }
    if (selectedCompiler.startsWith("clang")) {
        return (file.endsWith('cpp') || file.endsWith('c++') ? "clang++" : "clang");
    }
}

function formatArch(selectedArch) {
    if (selectedArch == "x64") {
        return "-m64";
    } else if (selectedArch == "x86") {
        return "-m32";
    } else {
        return "-march=" + selectedArch;
    }
}

function downloadExoticLibraries(callback) {
    console.log("Downloading Exotic Libraries...")
    var command = "";
    if (process.platform === "linux" || process.platform === "darwin") {
        command = "bash " + __dirname + "/../scripts/install.sh " + process.platform;
    } else {
        console.error("Exotic Action is not supported on this platform '" + process.platform + "'")
        callback(false);
        return;
    }
    exec.exec(command).then((result) => {
        console.log(result);
        callback(true);
    }).catch((error) => {
        console.error(error);
        callback(false);
    });
}














