import type { APIRoute } from 'astro';
import { changePassword } from '../../../lib/metaDashboardAuth';

export const prerender = false;

export const POST: APIRoute = async ({ redirect, request }) => {
  const formData = await request.formData();
  const currentPassword = String(formData.get('currentPassword') || '');
  const nextPassword = String(formData.get('nextPassword') || '');
  const confirmPassword = String(formData.get('confirmPassword') || '');

  if (nextPassword !== confirmPassword) {
    return redirect('/meta-change-password?error=Le%20nuove%20password%20non%20coincidono', 303);
  }

  const result = changePassword(currentPassword, nextPassword);

  if (!result.ok) {
    return redirect(`/meta-change-password?error=${encodeURIComponent(result.error)}`, 303);
  }

  return redirect('/meta-dashboard', 303);
};
