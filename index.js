
const core = require('@actions/core');
const github = require('@actions/github');
const exec = require("@actions/exec");
const util = require('util');
const jsexec = util.promisify(require('child_process').exec);
const fs = require('fs');
const path = require('path');
const homedir = require('os').homedir();
    
const supportedCompilers = [
    'gnu',
    'gcc',
    'clang',
    'tcc',
    'msvc'
];
const exoPath = homedir + "/exotic-libraries/";
const exoIncludePath = homedir + "/exotic-libraries/include/";
const globalParams = {
    msvcVsDevCmd: ""
};

main();
function main() {
    const downloadExLibs = getAndSanitizeInputs('download-exotic-libraries', 'boolean', true);
    const selectedExoticLibraries = getAndSanitizeInputs('selected-exotic-libraries', 'flatten_string', 'libcester');
    if (downloadExLibs === true) {
        downloadExoticLibraries(selectedExoticLibraries, exoIncludePath, async function(completed) {
            if (completed === true) {
                await afterDownloadDeps(exoIncludePath);
            } else {
                core.setFailed("Failed to download exotic libraries");
                return;
            }
        });
    } else {
        (async function() {
            await afterDownloadDeps(exoIncludePath);
        })()
    }
}

// TODO: treats install-compilers
async function afterDownloadDeps(exoIncludePath) {
    const actionOs = getAndSanitizeInputs('matrix.os', 'string', '');
    const compilerOptsForTests = getAndSanitizeInputs('compiler-options-for-tests', 'flatten_string', '');
    const runCesterRegression = getAndSanitizeInputs('run-regression', 'boolean', true);
    const cesterOpts = getAndSanitizeInputs('regression-cli-options', 'flatten_string', ['--cester-verbose --cester-nomemtest', '--cester-printversion']);
    const testFolders = getAndSanitizeInputs('test-folders', 'array', [ 'test/', 'tests/' ]);
    const testFolderRecursive = getAndSanitizeInputs('test-folder-recursive', 'boolean', false);
    const testFilePatterns = getAndSanitizeInputs('test-file-pattern', 'array', [ '^test_', '_test[.c](c\+\+|cpp|c)' ]);
    const testExludeFilePatterns = getAndSanitizeInputs('test-exclude-file-pattern', 'array', [ ]);
    const testExludeFilePatternsx86 = getAndSanitizeInputs('test-exclude-file-pattern-x86', 'array', [ ]);
    const testExludeFilePatternsx64 = getAndSanitizeInputs('test-exclude-file-pattern-x64', 'array', [ ]);
    const testExludeFilePatternsxMacOS = getAndSanitizeInputs('test-exclude-file-pattern-macos', 'array', [ ]);
    const testExludeFilePatternsxLinux = getAndSanitizeInputs('test-exclude-file-pattern-linux', 'array', [ ]);
    const testExludeFilePatternsxWindows = getAndSanitizeInputs('test-exclude-file-pattern-windows', 'array', [ ]);
    const selectedCompiler = getAndSanitizeInputs('the-matrix-compiler-internal-use-only', 'string', "");
    const selectedArchNoFormat = getAndSanitizeInputs('the-matrix-arch-internal-use-only', 'string', "");
    const selectedArch = formatArch(selectedCompiler, selectedArchNoFormat);
    
    if (!(await validateAndInstallAlternateCompiler(selectedCompiler, selectedArchNoFormat, actionOs, runCesterRegression))) {
        return;
    }
    var params = {
        numberOfTestsRan: 0,
        numberOfFailedTests: 0,
        numberOfTests: 0,
        regressionOutput: "",
        selectedArchNoFormat: selectedArchNoFormat
    }
    var yamlParams = {
        compilerOptsForTests: compilerOptsForTests,
        cesterOpts: cesterOpts,
        testFolderRecursive: testFolderRecursive,
        testFilePatterns: testFilePatterns,
        testExludeFilePatterns: testExludeFilePatterns,
        testExludeFilePatternsx86: testExludeFilePatternsx86,
        testExludeFilePatternsx64: testExludeFilePatternsx64,
        testExludeFilePatternsxMacOS: testExludeFilePatternsxMacOS,
        testExludeFilePatternsxLinux: testExludeFilePatternsxLinux,
        testExludeFilePatternsxWindows: testExludeFilePatternsxWindows,
        selectedCompiler: selectedCompiler,
        exoIncludePath: exoIncludePath,
        selectedArchNoFormat: selectedArchNoFormat,
        selectedArch: selectedArch
    }
    if (runCesterRegression === true && selectedCompiler !== "" && selectedArch !== undefined && (testFolders instanceof Array)) {
        var i;
        var j;
        var k;
        for (i = 0; i < testFolders.length; i++) {
            var folder = testFolders[i];
            if (!fs.existsSync(folder) || !fs.lstatSync(folder).isDirectory()) {
                core.setFailed("The test folder does not exist: " + folder);
                break;
            }
            try {
                await iterateFolderAndExecute(folder, params, yamlParams);
            } catch (error) {
                console.error("Failed to iterate the test folder: " + folder);
                core.setFailed(error);
                break;
            }
        }
        reportProgress(params);
    }
}

async function iterateFolderAndExecute(folder, params, yamlParams) {
    var files = fs.readdirSync(folder);
    if (!files) {
      core.setFailed("Could not list the content of test folder: " + folder);
      reportProgress(params);
      return;
    }
    var j;
    for (j = 0; j < files.length; ++j) {
        var file = files[j];
        var fullPath = path.join(folder, file);
        if (fs.lstatSync(fullPath).isDirectory()) {
            if (yamlParams.testFolderRecursive === true) {
                await iterateFolderAndExecute(fullPath, params, yamlParams);
            }
            continue;
        }
        if (!matchesInArray(yamlParams.testFilePatterns, file)) {
            continue;
        }
        if (matchesInArray(yamlParams.testExludeFilePatterns, file)) {
            continue;
        }
        if (yamlParams.selectedArchNoFormat == "x86") {
            if (matchesInArray(yamlParams.testExludeFilePatternsx86, file)) {
                continue;
            }
        }
        if (yamlParams.selectedArchNoFormat.indexOf("x64") !== -1) {
            if (matchesInArray(yamlParams.testExludeFilePatternsx64, file)) {
                continue;
            }
        }
        if (process.platform === "darwin") {
            if (matchesInArray(yamlParams.testExludeFilePatternsxMacOS, file)) {
                continue;
            }
        } else if (process.platform === "linux") {
            if (matchesInArray(yamlParams.testExludeFilePatternsxLinux, file)) {
                continue;
            }
        } else if (process.platform.startsWith("win")) {
            if (matchesInArray(yamlParams.testExludeFilePatternsxWindows, file)) {
                continue;
            }
        }
        
        if (matchesInArray(getAndSanitizeInputs(`test-exclude-file-pattern-${yamlParams.selectedCompiler}`, 'array', [ ]), file)) {
            continue;
        }
        
        var outputName = file.replace(/\.[^/.]+$/, "");
        var prefix = "./";
        if (process.platform.startsWith("win")) {
            outputName += ".exe";
            prefix = "";
        }
        let result = selectCompilerExec(yamlParams, fullPath, outputName);
        if (!result) {
            console.log(`The compiler ${yamlParams.selectedCompiler} cannot be used to compile the file ${file}`);
            continue;
        }
        let {
            compiler, 
            compilationOption,
            preCompileCommand
        } = result;
        let compilerOptsForTests = getAndSanitizeInputs(`compiler-options-for-tests-${yamlParams.selectedCompiler}`, 'flatten_string', 
                                                        (yamlParams.selectedCompiler === "msvc" ? " " : ""));
        if (compilerOptsForTests === "") {
            compilerOptsForTests = yamlParams.compilerOptsForTests;
        }
        params.numberOfTests++;
        console.log(`
===============================================================================================================
${outputName}
Compiler: ${compiler}
Compiler Options: ${yamlParams.compilerOptsForTests}
Runtime Options: ${yamlParams.cesterOpts}
===============================================================================================================
        `)
        var command = `${preCompileCommand} ${compiler} ${yamlParams.selectedArch} ${compilerOptsForTests} ${compilationOption}`;
        console.log(command);
        try {
            var { error, stdout, stderr } = await jsexec(command);
            console.log(stdout); console.log(stderr); if (error) { throw error; }
            var { error, stdout, stderr } = await jsexec(`${prefix}${outputName} ${yamlParams.cesterOpts}`);
            console.log(stdout); console.log(stderr); if (error) { throw error; }
            params.numberOfTestsRan++;
            params.regressionOutput += `\nPASSED ${outputName}`;
            try {
                var { error, stdout, stderr } = await jsexec(`rm ${outputName}`);
                console.log(stdout); console.log(stderr); console.log(error);
            } catch (error) { console.log(error) }
        } catch (error) {
            params.numberOfFailedTests++;
            params.numberOfTestsRan++;
            params.regressionOutput += `\nFAILED ${outputName}`;
            console.error("Process Error Code " + (error.code ? error.code : "Unknown"))
            console.error(!error.stdout ? (!error.stderr ? error : error.stderr) : error.stdout);
            if ((!error.stdout && !error.stderr) || (error.stdout.toString().indexOf("test") === -1 && 
                                                     error.stderr.toString().indexOf("test") === -1)) {
                console.error(error);
            }
        }
    }
}

/**
    This might fail to callthe afterAll 
    function though no case now, but case 
    is expected in future.
*/
function reportProgress(params) {
    if (params.numberOfTestsRan === params.numberOfTests) {
        afterAll(params);
    }
}

function afterAll(params) {
    try {
        const runCesterRegression = getAndSanitizeInputs('run-regression', 'boolean', true);
        
        core.setOutput("tests-passed", (params.numberOfFailedTests === 0));
        core.setOutput("tests-count", params.numberOfTests);
        core.setOutput("failed-tests-count", params.numberOfFailedTests);
        core.setOutput("passed-tests-count", params.numberOfTests - params.numberOfFailedTests);    
        
        // compilers paths
        core.setOutput("win32-clang-gcc-folder", "C:\\msys64\\" + ((params.selectedArchNoFormat === "x86") ? "mingw32" : "mingw64") + "\\bin\\");        
        if (runCesterRegression === true) {
            var percentagePassed = Math.round((100 * (params.numberOfTests - params.numberOfFailedTests)) / params.numberOfTests);
            console.log("Regression Result:")
            console.log(params.regressionOutput);
            console.log(`${percentagePassed}% tests passed, ${params.numberOfFailedTests} tests failed out of ${params.numberOfTests}`);
            if (params.numberOfTests !== 0 && params.numberOfFailedTests !== 0) {
                throw new Error("Regression test fails. Check the log above for details");
            }
        }

        // Get the JSON webhook payload for the event that triggered the workflow
        const payload = JSON.stringify(github.context.payload, undefined, 2)
        //console.log(`The event payload: ${payload}`);
    } catch (error) {
        core.setFailed(error.message);
    }
}

function matchesInArray(patternArray, text) {
    var k;
    for (k = 0; k < patternArray.length; k++) {
        var pattern = patternArray[k];
        //console.log(" <==>" + text + " in " + pattern + " is " + (new RegExp(pattern).test(text)));
        if (new RegExp(pattern).test(text)) {
            return true;
        }
    }
    return false;
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

function walkForFilesOnly(dir, extensions, callback) {
    var files = fs.readdirSync(dir);
    if (!files) {
        return callback(`Unable to read the folder '${dir}'`);
    }
    for (let file of files) {
        file = path.resolve(dir, file);
        if (fs.lstatSync(file).isDirectory()) {
            walkForFilesOnly(file, extensions, callback);
        } else {
            if (extensions) {
                let found = false;
                for (let extension of extensions) {
                    if (file.endsWith(extension)) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    continue;
                }
            }
            if (callback) {
                if (!callback(null, file)) {
                    break;
                }
            }
        }
    }
};
  

function selectCompilerExec(yamlParams, fullPath, outputName) {
    let generalOption = `-I. -I${yamlParams.exoIncludePath} ${fullPath} -o ${outputName}`;
    if (process.platform.startsWith("win")) {
        var arch = "64";
        if (yamlParams.selectedArchNoFormat === "x86") {
            arch = "32";
        }
        if (yamlParams.selectedCompiler.startsWith("gnu") || yamlParams.selectedCompiler.startsWith("gcc")) {
            if (yamlParams.selectedArchNoFormat === "x86") {
                console.log("EXOTIC.ACTION: issue with x86 libraries for gcc, using clang as replacement");
                return {
                    compiler: ((fullPath.endsWith('cpp') || fullPath.endsWith('c++')) ? "clang++.exe" : "clang.exe"),
                    compilationOption: generalOption,
                    preCompileCommand: ''
                };

            } else {
                return {
                    compiler: ((fullPath.endsWith('cpp') || fullPath.endsWith('c++')) ? "g++.exe" : "gcc.exe"),
                    compilationOption: generalOption,
                    preCompileCommand: ''
                };

            }
            
        } else if (yamlParams.selectedCompiler.startsWith("clang")) {
            return {
                compiler: ((fullPath.endsWith('cpp') || fullPath.endsWith('c++')) ? "clang++.exe" : "clang.exe"),
                compilationOption: generalOption,
                preCompileCommand: ''
            };
            
        } else if (yamlParams.selectedCompiler.startsWith("tcc") && fullPath.endsWith('c')) {
            return {
                compiler: `${exoPath}/tcc-win/tcc/tcc.exe`,
                compilationOption: generalOption,
                preCompileCommand: ''
            };

        } else if (yamlParams.selectedCompiler.startsWith("msvc")) {
            return {
                compiler: `cl`,
                compilationOption: ` /D__BASE_FILE__=\\\"${fullPath}\\\" /I. /I${yamlParams.exoIncludePath} ${fullPath} /Fe${outputName}`,
                preCompileCommand: `call "${globalParams.msvcVsDevCmd}" -arch=${yamlParams.selectedArchNoFormat} && `
            };

        }

    } else {
        if (yamlParams.selectedCompiler.startsWith("gnu") || yamlParams.selectedCompiler.startsWith("gcc")) {
            return {
                compiler: (fullPath.endsWith('cpp') || fullPath.endsWith('c++') ? "g++" : "gcc"),
                compilationOption: generalOption,
                preCompileCommand: ''
            };

        } else if (yamlParams.selectedCompiler.startsWith("clang")) {
            return {
                compiler: (fullPath.endsWith('cpp') || fullPath.endsWith('c++') ? "clang++" : "clang"),
                compilationOption: generalOption,
                preCompileCommand: ''
            };

        } else if (yamlParams.selectedCompiler.startsWith("tcc") && fullPath.endsWith('c')) {
            return {
                compiler: yamlParams.selectedCompiler,
                compilationOption: generalOption,
                preCompileCommand: ''
            };

        }
    }
}

async function validateAndInstallAlternateCompiler(selectedCompiler, arch, actionOs, runCesterRegression) {
    if (!runCesterRegression) { return true; }
    if (!supportedCompilers.includes(selectedCompiler)) {
        core.setFailed("Exotic Action does not support the compiler '" + selectedCompiler + "'");
        return false;
    }
    if (selectedCompiler === "tcc") {
        if (process.platform === "linux" && (arch === "x64" || arch === "x86_64")) {
            var { error, stdout, stderr } = await jsexec('sudo apt-get install -y tcc');
            console.log(stdout); console.log(stderr); console.log(error);
            return true;

        } else if (process.platform === "win32") {
            if (!fs.existsSync(exoPath)){
                fs.mkdirSync(exoPath, { recursive: true });
            }
            if (arch.startsWith("x") && arch.endsWith("64")) {
                var { error, stdout, stderr } = await jsexec(`powershell -Command "Invoke-WebRequest -uri 'https://download.savannah.nongnu.org/releases/tinycc/tcc-0.9.27-win64-bin.zip' -Method 'GET'  -Outfile '${exoPath}/tcc-win.zip'"`);
                console.log(stdout); console.log(stderr); console.log(error);

            } else if (arch === "x86" || arch == "i386") {
                var { error, stdout, stderr } = await jsexec(`powershell -Command "Invoke-WebRequest -uri 'https://download.savannah.nongnu.org/releases/tinycc/tcc-0.9.27-win32-bin.zip' -Method 'GET'  -Outfile '${exoPath}/tcc-win.zip'"`);
                console.log(stdout); console.log(stderr); console.log(error);

            } else {
                console.log(`The compiler '${selectedCompiler}' not supported on this platform '${process.platform}:${arch}'`);
                return false;
            }
            var { error, stdout, stderr } = await jsexec(`powershell -Command "Expand-Archive '${exoPath}/tcc-win.zip' -DestinationPath '${exoPath}/tcc-win' -Force"`);
            console.log(stdout); console.log(stderr); console.log(error);
            return true;

        } else {
            console.log(`The compiler '${selectedCompiler}' not supported on this platform '${process.platform}:${arch}'`);
            return false;
        }
    } else if (selectedCompiler === "msvc") {
        if (process.platform === "win32") {
            let foundCompiler = false;
            let year = (actionOs.indexOf("2016") > -1 ? "2016" : "2019");
            walkForFilesOnly(`C:/Program Files (x86)/Microsoft Visual Studio/${year}/Enterprise/Common7/Tools/`, [".bat"], function (err, file) {
                if (err) {
                    return false;
                }
                if (file.endsWith("VsDevCmd.bat")) {
                    globalParams.msvcVsDevCmd = file;
                    foundCompiler = true;
                    return false;
                }
                return true;
            });
            if (!foundCompiler) {
                core.setFailed(`Unable to configure '${selectedCompiler}' not supported on this platform '${process.platform}:${arch}'.`);
                return false;
            }
            return true;

        } else {
            console.log(`The compiler '${selectedCompiler}' not supported on this platform '${process.platform}:${arch}'`);
            return false;
        }
    }
    return true;
}

function formatArch(selectedCompiler, selectedArch) {
    if (selectedArch.startsWith("x") && selectedArch.endsWith("64")) { //x64 and x86_64 - 64 bits
        if (selectedCompiler === "msvc") {
            return "";
        }
        return "-m64";
    } else if (selectedArch === "x86" || selectedArch == "i386") { //x86 - 32 bits
        if (process.platform === "darwin") { // The i386 architecture is deprecated for macOS
            return "-m64";
        }
        if (selectedCompiler === "msvc") {
            return "";
        }
        return "-m32";
    } else {
        return "-march=" + selectedArch;
    }
}

function downloadExoticLibraries(selectedLibs, exoIncludePath, callback) {
    var command1 = "", command2 = "", command3 = "", command4 = "";
    const selectedArch = getAndSanitizeInputs('the-matrix-arch-internal-use-only', 'string', "");
    
    console.log("Downloading Exotic Libraries...");
    if (!fs.existsSync(exoIncludePath)){
        fs.mkdirSync(exoIncludePath, { recursive: true });
    }
    if (process.platform === "linux" || process.platform === "darwin") {
        command1 = `curl -s https://exoticlibraries.github.io/magic/install.sh -o exotic-install.sh`
        command2 = `bash ./exotic-install.sh --installfolder=${exoIncludePath} ${selectedLibs}`;
        command3 = `sudo bash ./exotic-install.sh ${selectedLibs}`;
        if (process.platform === "linux") {
            command4 = 'sudo apt-get install gcc-multilib g++-multilib';
        }
        
    } else if (process.platform === "win32") {
        command1 = `powershell -Command "& $([scriptblock]::Create((New-Object Net.WebClient).DownloadString('https://exoticlibraries.github.io/magic/install.ps1')))" --InstallFolder=${exoIncludePath} ${selectedLibs}`;
        command2 = `powershell -Command "& $([scriptblock]::Create((New-Object Net.WebClient).DownloadString('https://exoticlibraries.github.io/magic/install.ps1')))" ${selectedLibs}`;
        
    } else {
        console.error("Exotic Action is not supported on this platform '" + process.platform + " " + selectedArch + "'")
        callback(false);
        return;
    }
    console.log(command1);
    exec.exec(command1).then((result) => {
        if (result === 0) {
            if (command2 !== "") {
                console.log(command2);
                exec.exec(command2).then((result) => {
                    if (result === 0) {
                        if (command3 !== "") {
                            console.log(command3);
                            exec.exec(command3).then((result) => {
                                if (result === 0) {
                                    if (command4 !== "") {
                                        console.log(command4);
                                        exec.exec(command4).then((result) => {
                                            if (result === 0) {
                                                callback(true);
                                            } else {
                                                callback(false);
                                            }
                                        }).catch((error) => {
                                            console.error(error);
                                            callback(false);
                                        });
                                    } else {
                                        callback(true);
                                    }
                                } else {
                                    callback(false);
                                }
                            }).catch((error) => {
                                console.error(error);
                                callback(false);
                            });
                        } else {
                            callback(true);
                        }
                    } else {
                        callback(false);
                    }
                }).catch((error) => {
                    console.error(error);
                    callback(false);
                });
            } else {
                callback(true);
            }
        } else {
            callback(false);
        }
    }).catch((error) => {
        console.error(error);
        callback(false);
    });
}













