export type NotifType = 'LIKE' | 'COMMENT' | 'MENTION' | 'REPOST' | 'FOLLOW' | 'MESSAGE';
export interface EmailPayload {
    toEmail: string;
    toName: string;
    actorName: string;
    actorAvatar?: string;
    type: NotifType;
    postTitle?: string;
    commentBody?: string;
    postUrl?: string;
}
export declare function sendNotificationEmail(payload: EmailPayload): Promise<void>;
//# sourceMappingURL=emailService.d.ts.map