import { NotifType } from './utils/emailService';
interface CreateNotifOptions {
    recipientId: string;
    actorId: string;
    type: NotifType;
    postId?: string;
    commentId?: string;
    commentBody?: string;
}
export declare function createNotification(opts: CreateNotifOptions): Promise<void>;
export {};
//# sourceMappingURL=notificationService.d.ts.map