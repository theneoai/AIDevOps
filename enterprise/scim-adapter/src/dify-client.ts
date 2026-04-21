/**
 * Dify Console API client for member management operations.
 *
 * Maps SCIM operations to Dify's /console/api/workspaces/current/members endpoints.
 * Authenticates once with email+password, caches the JWT.
 */
import axios, { AxiosInstance } from 'axios';
import { createLogger } from './logger';

const logger = createLogger('dify-client');

export interface DifyMember {
  id: string;
  name: string;
  email: string;
  role: string;   // 'owner' | 'admin' | 'editor' | 'normal' | 'dataset_operator'
  status: string; // 'active' | 'pending' | 'banned'
  avatar?: string;
  createdAt?: string;
  lastActiveAt?: string;
}

export class DifyMemberClient {
  private client: AxiosInstance;
  private sessionToken: string | null = null;
  private email: string;
  private password: string;

  constructor(baseUrl: string, email: string, password: string) {
    this.email = email;
    this.password = password;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 15_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async ensureAuth(): Promise<void> {
    if (this.sessionToken) return;
    const res = await this.client.post('/console/api/login', {
      email: this.email,
      password: this.password,
      remember_me: true,
    });
    this.sessionToken = res.data?.data?.access_token;
    if (!this.sessionToken) throw new Error('No access_token in Dify login response');
    this.client.defaults.headers.common['Authorization'] = `Bearer ${this.sessionToken}`;
    logger.info('Authenticated with Dify console API');
  }

  invalidateToken(): void {
    this.sessionToken = null;
    delete this.client.defaults.headers.common['Authorization'];
  }

  private async withAuth<T>(fn: () => Promise<T>): Promise<T> {
    await this.ensureAuth();
    try {
      return await fn();
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 401) {
        this.invalidateToken();
        await this.ensureAuth();
        return fn();
      }
      throw err;
    }
  }

  async listMembers(): Promise<DifyMember[]> {
    return this.withAuth(async () => {
      const res = await this.client.get('/console/api/members');
      return (res.data?.data ?? []) as DifyMember[];
    });
  }

  async getMember(memberId: string): Promise<DifyMember | null> {
    return this.withAuth(async () => {
      const members = await this.listMembers();
      return members.find((m) => m.id === memberId) ?? null;
    });
  }

  async getMemberByEmail(email: string): Promise<DifyMember | null> {
    return this.withAuth(async () => {
      const members = await this.listMembers();
      return members.find((m) => m.email.toLowerCase() === email.toLowerCase()) ?? null;
    });
  }

  /**
   * Invite a new user to the workspace.
   * Dify sends an invite email; the user must accept before they appear as active.
   */
  async inviteMember(email: string, role: string): Promise<DifyMember> {
    return this.withAuth(async () => {
      const res = await this.client.post('/console/api/members/invite-emails', {
        emails: [email],
        role,
      });
      // Dify returns an array of results — pick the first matching email
      const results: Array<{ email: string; id: string; status: string }> =
        res.data?.result ?? [];
      const match = results.find((r) => r.email === email);
      if (!match) throw new Error(`Invite for ${email} not found in Dify response`);
      return { id: match.id, name: '', email, role, status: 'pending' };
    });
  }

  /**
   * Update the role of an existing member.
   */
  async updateMemberRole(memberId: string, role: string): Promise<void> {
    return this.withAuth(async () => {
      await this.client.put(`/console/api/members/${memberId}`, { role });
    });
  }

  /**
   * Remove a member from the workspace.
   * Uses the Dify console endpoint; does not delete the user's account.
   */
  async removeMember(memberId: string): Promise<void> {
    return this.withAuth(async () => {
      await this.client.delete(`/console/api/members/${memberId}`);
    });
  }
}
