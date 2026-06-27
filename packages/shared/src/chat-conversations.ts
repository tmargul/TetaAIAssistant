import type { ChatMessage, ChatModel, ChatMessageFeedback } from './chat.js';

export interface ChatConversationRecord {
  id: string;
  title: string;
  model: ChatModel;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatConversationSummary {
  id: string;
  title: string;
  model: ChatModel;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatConversationsListResponse {
  conversations: ChatConversationSummary[];
}

export interface SaveChatConversationRequest {
  id: string;
  title: string;
  model: ChatModel;
  messages: ChatMessage[];
}

export interface CreateChatConversationRequest {
  model?: ChatModel;
}

export interface SubmitChatMessageFeedbackRequest {
  feedback: ChatMessageFeedback;
}

export interface SubmitChatMessageFeedbackResponse {
  conversation: ChatConversationRecord;
  linksLearned: number;
}
