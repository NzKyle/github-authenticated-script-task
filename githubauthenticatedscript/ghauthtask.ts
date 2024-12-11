import path = require("path");
import tl = require("azure-pipelines-task-lib/task");
import {Utility} from "./operations/Utility";
import {ScriptType, ScriptTypeFactory} from "./operations/ScriptType";


const FAIL_ON_STDERR: string = "FAIL_ON_STDERR";

export class ghauthtask {

    public static async runMain(): Promise<void> {
        let toolExecutionError = null;
        let exitCode: number = 0;

        let scriptType: ScriptType = ScriptTypeFactory.getSriptType();
        
        try {

            Utility.loginGhCli(tl.getInput("gitHubServiceConnection", true));
           
            let tool: any = await scriptType.getTool();
            let cwd: string = tl.getPathInput("cwd", true, false);
            if (tl.getInput("scriptLocation", true).toLowerCase() === "scriptPath" && !tl.filePathSupplied("cwd")) {
                cwd = path.dirname(tl.getPathInput("scriptPath", true, true));
            }

            // determines whether output to stderr will fail a task.
            // some tools write progress and other warnings to stderr.  scripts can also redirect.
            let failOnStdErr: boolean = tl.getBoolInput("failOnStandardError", false);
            tl.mkdirP(cwd);
            tl.cd(cwd);

            let errLinesCount: number = 0;
            let aggregatedErrorLines: string[] = [];

            tool.on('errline', (errorLine: string) => {
                if (errLinesCount < 10) {
                    aggregatedErrorLines.push(errorLine);
                }
                errLinesCount++;
            });

            exitCode = await tool.exec({
                failOnStdErr: false,
                ignoreReturnCode: true
            });

            if (failOnStdErr && aggregatedErrorLines.length > 0) {
                let error = FAIL_ON_STDERR;
                tl.error(aggregatedErrorLines.join("\n"), tl.IssueSource.CustomerScript);
                throw error;
            }
            
        } catch (err: any) {
            toolExecutionError = err;
            if (err.stderr) {
                toolExecutionError = err.stderr;
            }
        } finally {

            if (scriptType) {
                await scriptType.cleanUp();
            }

            //set the task result to either succeeded or failed based on error was thrown or not
            if (toolExecutionError === FAIL_ON_STDERR) {
                tl.setResult(tl.TaskResult.Failed, tl.loc("ScriptFailedStdErr"));
            } else if (toolExecutionError) {
                let message = tl.loc('ScriptFailed', toolExecutionError);

                // only Aggregation error contains array of errors
                if (toolExecutionError.errors) {
                    // Iterates through array and log errors separately
                    toolExecutionError.errors.forEach((error: any) => {
                        tl.error(error.message, tl.IssueSource.TaskInternal);
                    });

                    // fail with main message
                    tl.setResult(tl.TaskResult.Failed, toolExecutionError.message);
                } else {
                    tl.setResult(tl.TaskResult.Failed, message);
                }

                tl.setResult(tl.TaskResult.Failed, message);
                
            } else if (exitCode != 0) {
                tl.setResult(tl.TaskResult.Failed, tl.loc("ScriptFailedWithExitCode", exitCode));
            } else {
                tl.setResult(tl.TaskResult.Succeeded, tl.loc("ScriptReturnCode", 0));
            }

            //Logout of Azure if logged in
            Utility.logoutGhCli();
        }
    }
}

ghauthtask.runMain();
