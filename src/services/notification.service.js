/**
 * Notification Service — manages notification feed generation from existing records,
 * read/unread state tracking in JSONB, preferences, and Web Push subscriptions.
 */

const supabase = require("../config/supabase");

function opError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.isOperational = true;
  return err;
}

class NotificationService {
  /**
   * Retrieves the notification feed for an authorized administrator.
   * Generates feed on-demand from existing `forms` and `reviews` records.
   */
  async getAdminNotifications(user, query = {}) {
    // 1. Fetch current admin's preferences and read/dismissed state
    const { data: userData, error: userErr } = await supabase
      .from("users")
      .select("notification_preferences")
      .eq("id", user.id)
      .maybeSingle();

    if (userErr) {
      throw new Error(`Failed to load notification preferences: ${userErr.message}`);
    }

    const prefs = userData?.notification_preferences || {};
    const readIds = Array.isArray(prefs.read_ids) ? prefs.read_ids : [];
    const dismissedIds = Array.isArray(prefs.dismissed_ids) ? prefs.dismissed_ids : [];

    const items = [];

    // 2. Load forms if preference allows (default true)
    if (prefs.forms !== false) {
      const { data: forms, error: formsErr } = await supabase
        .from("forms")
        .select("id, form_type, data, status, created_at")
        .order("created_at", { ascending: false })
        .limit(100);

      if (formsErr) {
        throw new Error(`Failed to load form notifications: ${formsErr.message}`);
      }

      if (forms) {
        for (const f of forms) {
          if (dismissedIds.includes(f.id)) continue;
          const isContact = f.form_type === "CONTACT";
          items.push({
            id: f.id,
            type: isContact ? "CONTACT_FORM" : "SELL_CAR_FORM",
            source_record_id: f.id,
            source_type: "forms",
            title: isContact ? "New Contact Inquiry" : "New Sell Your Car Submission",
            summary: isContact
              ? (f.data?.name ? `Contact inquiry from ${f.data.name}` : "New contact message received")
              : (f.data?.brand ? `Appraisal request for ${f.data.brand} ${f.data.model || ""}`.trim() : "New vehicle valuation request"),
            link: `/admin/forms/${f.id}`,
            created_at: f.created_at,
            is_read: readIds.includes(f.id),
          });
        }
      }
    }

    // 3. Load reviews if preference allows (default true)
    if (prefs.reviews !== false) {
      const { data: reviews, error: revErr } = await supabase
        .from("reviews")
        .select("id, name, rating, text, status, created_at")
        .neq("status", "DELETED")
        .order("created_at", { ascending: false })
        .limit(100);

      if (revErr) {
        throw new Error(`Failed to load review notifications: ${revErr.message}`);
      }

      if (reviews) {
        for (const r of reviews) {
          if (dismissedIds.includes(r.id)) continue;
          items.push({
            id: r.id,
            type: "NEW_REVIEW",
            source_record_id: r.id,
            source_type: "reviews",
            title: "New Review Submitted",
            summary: `${r.rating}★ rating from ${r.name}`,
            link: `/admin/reviews/${r.id}`,
            created_at: r.created_at,
            is_read: readIds.includes(r.id),
          });
        }
      }
    }

    // 4. Apply Type Filter
    let filtered = items;
    if (query.type) {
      filtered = filtered.filter((item) => item.type === query.type);
    }

    // 5. Apply Read/Unread Filter
    if (query.status === "read") {
      filtered = filtered.filter((item) => item.is_read);
    } else if (query.status === "unread") {
      filtered = filtered.filter((item) => !item.is_read);
    }

    // 6. Sort
    if (query.sort === "oldest") {
      filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } else {
      filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    // 7. Pagination
    const total = filtered.length;
    const unreadCount = filtered.filter((i) => !i.is_read).length;
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const paginated = filtered.slice(offset, offset + limit);

    return {
      notifications: paginated,
      unread_count: unreadCount,
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Mark a notification entry as read for the authenticated admin
   */
  async markRead(userId, notificationId) {
    const { data: user } = await supabase
      .from("users")
      .select("notification_preferences")
      .eq("id", userId)
      .single();

    const prefs = user?.notification_preferences || {};
    const readIds = Array.isArray(prefs.read_ids) ? [...prefs.read_ids] : [];

    if (!readIds.includes(notificationId)) {
      readIds.push(notificationId);
      const updatedPrefs = { ...prefs, read_ids: readIds };

      const { error } = await supabase
        .from("users")
        .update({
          notification_preferences: updatedPrefs,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (error) {
        throw new Error(`Failed to update read state: ${error.message}`);
      }
    }

    return { id: notificationId, is_read: true };
  }

  /**
   * Mark a notification entry as unread for the authenticated admin
   */
  async markUnread(userId, notificationId) {
    const { data: user } = await supabase
      .from("users")
      .select("notification_preferences")
      .eq("id", userId)
      .single();

    const prefs = user?.notification_preferences || {};
    const readIds = (Array.isArray(prefs.read_ids) ? prefs.read_ids : []).filter(
      (id) => id !== notificationId
    );

    const updatedPrefs = { ...prefs, read_ids: readIds };

    const { error } = await supabase
      .from("users")
      .update({
        notification_preferences: updatedPrefs,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (error) {
      throw new Error(`Failed to update unread state: ${error.message}`);
    }

    return { id: notificationId, is_read: false };
  }

  /**
   * Dismiss/delete notification representation without touching underlying source records
   */
  async dismissNotification(userId, notificationId) {
    const { data: user } = await supabase
      .from("users")
      .select("notification_preferences")
      .eq("id", userId)
      .single();

    const prefs = user?.notification_preferences || {};
    const dismissedIds = Array.isArray(prefs.dismissed_ids) ? [...prefs.dismissed_ids] : [];

    if (!dismissedIds.includes(notificationId)) {
      dismissedIds.push(notificationId);
      const updatedPrefs = { ...prefs, dismissed_ids: dismissedIds };

      const { error } = await supabase
        .from("users")
        .update({
          notification_preferences: updatedPrefs,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (error) {
        throw new Error(`Failed to dismiss notification: ${error.message}`);
      }
    }

    return { id: notificationId, dismissed: true };
  }

  /**
   * Retrieve notification preferences for an authenticated user
   */
  async getPreferences(userId) {
    const { data: user, error } = await supabase
      .from("users")
      .select("notification_preferences")
      .eq("id", userId)
      .single();

    if (error || !user) {
      throw new Error(`Failed to load preferences: ${error?.message || "User not found"}`);
    }

    const p = user.notification_preferences || {};
    return {
      forms: p.forms ?? true,
      reviews: p.reviews ?? true,
      push: p.push ?? true,
      sound: p.sound ?? true,
    };
  }

  /**
   * Update notification preferences for an authenticated user
   */
  async updatePreferences(userId, updateFields) {
    const { data: user, error: fetchErr } = await supabase
      .from("users")
      .select("notification_preferences")
      .eq("id", userId)
      .single();

    if (fetchErr || !user) {
      throw new Error(`Failed to fetch user preferences: ${fetchErr?.message || "User not found"}`);
    }

    const current = user.notification_preferences || {};
    const merged = { ...current, ...updateFields };

    const { error: updateErr } = await supabase
      .from("users")
      .update({
        notification_preferences: merged,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (updateErr) {
      throw new Error(`Failed to update preferences: ${updateErr.message}`);
    }

    return {
      forms: merged.forms ?? true,
      reviews: merged.reviews ?? true,
      push: merged.push ?? true,
      sound: merged.sound ?? true,
    };
  }

  /**
   * Register a browser push subscription on the authenticated user account
   */
  async subscribePush(userId, { endpoint, keys }) {
    const { data: user, error: fetchErr } = await supabase
      .from("users")
      .select("push_subscriptions")
      .eq("id", userId)
      .single();

    if (fetchErr || !user) {
      throw new Error(`Failed to load subscriptions: ${fetchErr?.message || "User not found"}`);
    }

    const subs = Array.isArray(user.push_subscriptions) ? [...user.push_subscriptions] : [];
    const existingIndex = subs.findIndex((s) => s.endpoint === endpoint);

    if (existingIndex !== -1) {
      // Update existing subscription entry
      subs[existingIndex] = {
        ...subs[existingIndex],
        keys,
        updated_at: new Date().toISOString(),
      };
    } else {
      // Append new subscription entry
      subs.push({
        endpoint,
        keys,
        created_at: new Date().toISOString(),
      });
    }

    const { error: saveErr } = await supabase
      .from("users")
      .update({
        push_subscriptions: subs,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (saveErr) {
      throw new Error(`Failed to save push subscription: ${saveErr.message}`);
    }

    return { subscribed: true, total_subscriptions: subs.length };
  }

  /**
   * Remove a browser push subscription for the authenticated user
   */
  async unsubscribePush(userId, endpoint) {
    const { data: user, error: fetchErr } = await supabase
      .from("users")
      .select("push_subscriptions")
      .eq("id", userId)
      .single();

    if (fetchErr || !user) {
      throw new Error(`Failed to load subscriptions: ${fetchErr?.message || "User not found"}`);
    }

    const subs = (Array.isArray(user.push_subscriptions) ? user.push_subscriptions : []).filter(
      (s) => s.endpoint !== endpoint
    );

    const { error: saveErr } = await supabase
      .from("users")
      .update({
        push_subscriptions: subs,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (saveErr) {
      throw new Error(`Failed to remove push subscription: ${saveErr.message}`);
    }

    return { subscribed: false, total_subscriptions: subs.length };
  }

  // ── Notification Generation Integrations ───────────────────────────────────

  /**
   * Dispatched upon successful CONTACT form creation
   */
  async notifyNewContactForm(form) {
    // In serverless architecture, new records are dynamically reflected in the feed.
    // Here we can log and asynchronously trigger push notifications if configured.
    return { success: true, event: "CONTACT_FORM", source_id: form.id };
  }

  /**
   * Dispatched upon successful SELL_CAR form creation
   */
  async notifyNewSellCarForm(form) {
    return { success: true, event: "SELL_CAR_FORM", source_id: form.id };
  }

  /**
   * Dispatched upon successful REVIEW creation
   */
  async notifyNewReview(review) {
    return { success: true, event: "NEW_REVIEW", source_id: review.id };
  }
}

module.exports = new NotificationService();
