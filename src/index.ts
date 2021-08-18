import {Probot} from 'probot';
import {ArgusBot} from './bot';
import {getWorkflowPrNumbers, getWorkflowRunConclusion, getWorkflowRunId} from './selectors';
import {getFailureReport, getScreenshotDiffImages, zip} from './utils';
import {BOT_REPORT_MESSAGES} from './constants';
import {IBotConfigs} from './types';

const reposConfigsStorage: Record<string, IBotConfigs> = {};

export = (app: Probot) => {
    app.on('workflow_run.completed', async context => {
        const bot = new ArgusBot(context);
        const {repo} = context.repo();
        const [prNumber] = getWorkflowPrNumbers(context);

        if (!reposConfigsStorage[repo]) {
            reposConfigsStorage[repo] = await bot.loadBotConfigs();
        }

        switch (getWorkflowRunConclusion(context)) {
            case 'success':
                return bot.createOrUpdateReport(prNumber, BOT_REPORT_MESSAGES.SUCCESS_WORKFLOW);

            case 'failure':
                const workflowRunId = getWorkflowRunId(context);

                if (!workflowRunId) return;

                /** TODO possibly there is a need to add timeout because at this time there are not always artifacts (test it!) */
                const [artifact] = await bot.getWorkflowArtifacts<ArrayBuffer>(workflowRunId);
                const images = getScreenshotDiffImages(artifact);
                const imagesUrls = await bot.uploadImages(images.map(image => image.getData()), prNumber);

                const reportText = images.length
                    ? getFailureReport(zip(images, imagesUrls))
                    : BOT_REPORT_MESSAGES.FAILED_WORKFLOW_NO_SCREENSHOTS;

                return bot.createOrUpdateReport(prNumber, reportText);

            default:
                return;
        }
    });

    /**
     * WARNING: "Re-run all jobs" button does not trigger worklow_run.requested event
     * see {@link https://github.com/actions/runner/issues/726 github issue}
     * */
    app.on('workflow_run.requested', async context => {
        const bot = new ArgusBot(context);
        const [prNumber] = getWorkflowPrNumbers(context);

        return bot.createOrUpdateReport(prNumber, BOT_REPORT_MESSAGES.LOADING_WORKFLOW);
    });

    app.on('pull_request.closed', async context => {
        const bot = new ArgusBot(context);
        const prNumber = context.payload.number;

        return bot.deleteUploadedImagesFolder(prNumber)
            .then(() => bot.createOrUpdateReport(prNumber, BOT_REPORT_MESSAGES.PR_CLOSED));
    });
};
