import {Context} from 'probot/lib/context';
import {
    BOT_COMMIT_MESSAGE,
    BOT_CONFIGS_FILE_NAME,
    DEFAULT_BOT_CONFIGS,
    DEFAULT_MAIN_BRANCH,
    GITHUB_CDN_DOMAIN,
    IMAGES_STORAGE_FOLDER,
    STORAGE_BRANCH,
    TEST_REPORT_HIDDEN_LABEL,
} from './constants';
import {
    checkContainsHiddenLabel,
    markCommentWithHiddenLabel,
    parseTomlFileBase64Str,
} from './utils';
import {IBotConfigs} from './types';

export abstract class Bot {
    constructor(protected context: Context) {}

    /**
     * Send comment to the issue
     * (pull request is the same issue but with code)
     * @param issueNumber
     * @param markdownText string (optionally, can include markdown syntax)
     */
    async sendComment(issueNumber: number, markdownText: string) {
        const comment = this.context.repo({
            body: markdownText,
            issue_number: issueNumber,
        });

        return this.context.octokit.issues.createComment(comment);
    }

    /**
     * Update certain comment in the issue (pull request is the same issue but with code)
     * @param commentId
     * @param newMarkdownContent string (optionally, can include markdown syntax)
     */
    async updateComment(commentId: number, newMarkdownContent: string) {
        return this.context.octokit.rest.issues.updateComment({
            ...this.context.repo(),
            comment_id: commentId,
            body: newMarkdownContent,
        });
    }

    /**
     * Get info about all comments in the current issue/PR
     */
    async getCommentsByIssueId(issueNumber: number) {
        return this.context.octokit.rest.issues.listComments({
            ...this.context.repo(),
            issue_number: issueNumber,
        }).then(({data}) => data);
    }

    /**
     * Download artifacts (zip files) in the workflow and unpack them
     */
    async getWorkflowArtifacts<T>(workflowRunId: number): Promise<T[]> {
        const workflowRunInfo = this.context.repo({
            run_id: workflowRunId,
        });

        const artifactsInfo = await this.context.octokit.actions.listWorkflowRunArtifacts(workflowRunInfo)
            .catch(() => null);

        if (artifactsInfo) {
            const artifactsMetas = artifactsInfo.data.artifacts
                .map(({id}) => this.context.repo({artifact_id: id, archive_format: 'zip'}))
            const artifactsRequests = artifactsMetas
                .map(meta => this.context.octokit.actions.downloadArtifact(meta).then(({data}) => data as T));

            return Promise.all(artifactsRequests);
        }

        return [];
    };

    /**
     * Get file (+ meta info about it) by its path in the repository
     * @param path file location (from root of repo)
     * @param branch target branch
     * (it branch params is not provided it takes the repository’s default branch (usually master/main))
     */
    async getFile(path: string, branch?: string) {
        return this.context.octokit.repos.getContent({
            ...this.context.repo(),
            path,
            ref: branch
        }).catch(() => null);
    }

    /**
     * Get info about git branch by its name
     */
    async getBranchInfo(branch: string) {
        return this.context.octokit.rest.repos.getBranch({...this.context.repo(), branch}).catch(() => null);
    }

    /**
     * Create git branch in current repository (do nothing if branch already exists)
     * @param branch new branch name
     * @param fromBranch from which to create new branch
     */
    async createBranch(branch: string, fromBranch = DEFAULT_MAIN_BRANCH) {
        if (await this.getBranchInfo(branch)) {
            return;
        }

        const fromBranchInfo = await this.context.octokit.rest.repos.getBranch({
            ...this.context.repo(),
            branch: fromBranch
        });

        return this.context.octokit.rest.git.createRef({
            ...this.context.repo(),
            ref: `refs/heads/${branch}`,
            sha: fromBranchInfo.data.commit.sha,
        });
    }

    /**
     * Upload file to a separate branch
     */
    async uploadFile({file, path, branch, commitMessage}: {
        /** buffer of the file */
        file: Buffer,
        /** path of future file (including file name + file format) */
        path: string,
        commitMessage: string,
        branch: string
    }): Promise<string> {
        const {repo, owner} = this.context.repo();
        const content = file.toString('base64');
        const oldFileVersion = await this.getFile(path, branch);

        return this.context.octokit.repos
            .createOrUpdateFileContents({
                owner,
                repo,
                content,
                path,
                branch,
                sha: oldFileVersion && 'sha' in oldFileVersion.data ? oldFileVersion.data.sha : undefined,
                message: commitMessage,
            })
            .then(() => `${GITHUB_CDN_DOMAIN}/${owner}/${repo}/${branch}/${path}`);
    }

    async deleteFile({path, commitMessage, branch}: {
        path: string,
        commitMessage: string,
        branch: string
    }) {
        const oldFileVersion = await this.getFile(path, branch);

        if (!(oldFileVersion && 'sha' in oldFileVersion.data)) {
            return Promise.reject('the file is not found!');
        }

        return this.context.octokit.rest.repos.deleteFile({
            ...this.context.repo(),
            path,
            branch,
            message: commitMessage,
            sha: oldFileVersion.data.sha,
        })
    }
}

export class ArgusBot extends Bot {
    async loadBotConfigs(): Promise<IBotConfigs> {
        return this.getFile(BOT_CONFIGS_FILE_NAME)
            .then(res => res?.data && 'content' in res.data ? res.data.content : '')
            .then(base64Str => parseTomlFileBase64Str<IBotConfigs>(base64Str))
            .catch(() => DEFAULT_BOT_CONFIGS);
    }

    async getPrevBotReportComment(prNumber: number) {
        const prComments = await this.getCommentsByIssueId(prNumber);

        return prComments.find(
            ({body}) => checkContainsHiddenLabel(body || '', TEST_REPORT_HIDDEN_LABEL)
        ) || null;
    }

    async createOrUpdateReport(prNumber: number, markdownText: string) {
        const oldBotComment = await this.getPrevBotReportComment(prNumber);
        const markedMarkdownText = markCommentWithHiddenLabel(markdownText, TEST_REPORT_HIDDEN_LABEL);

        return oldBotComment?.id
            ? this.updateComment(oldBotComment.id, markedMarkdownText)
            : this.sendComment(prNumber, markedMarkdownText);
    }

    async uploadImages(images: Buffer[], prNumber: number) {
        await this.createBranch(STORAGE_BRANCH);

        return Promise.all(images.map(
            (file, index) => this.uploadFile({
                file,
                path: `${this.getSavedImagePathPrefix(prNumber)}/${index}.png`,
                commitMessage: BOT_COMMIT_MESSAGE.UPLOAD_IMAGE,
                branch: STORAGE_BRANCH,
            })
        ));
    }

    async deleteUploadedImagesFolder(prNumber: number) {
        const folder = await this.getFile(
            this.getSavedImagePathPrefix(prNumber),
            STORAGE_BRANCH
        );

        if (folder && Array.isArray(folder.data)) {
            return Promise.all(
                folder.data.map(({path}) => this.deleteFile({
                    path,
                    commitMessage: BOT_COMMIT_MESSAGE.DELETE_FOLDER,
                    branch: STORAGE_BRANCH
                }))
            );
        }

        return null;
    }

    private getSavedImagePathPrefix(prNumber: number): string {
        const {repo, owner} = this.context.repo();

        return `${IMAGES_STORAGE_FOLDER}/${owner}-${repo}-${prNumber}`;
    }
}
