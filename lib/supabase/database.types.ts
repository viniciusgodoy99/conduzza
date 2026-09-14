export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_decision_log: {
        Row: {
          blocked_draft: string | null
          clinic_id: string
          compliance_blocked: boolean
          compliance_rule: string | null
          context_read: Json | null
          conversation_id: string
          created_at: string
          escalation_reason: string | null
          id: string
          latency_ms: number | null
          message_id: string | null
          tool_used: string | null
        }
        Insert: {
          blocked_draft?: string | null
          clinic_id: string
          compliance_blocked?: boolean
          compliance_rule?: string | null
          context_read?: Json | null
          conversation_id: string
          created_at?: string
          escalation_reason?: string | null
          id?: string
          latency_ms?: number | null
          message_id?: string | null
          tool_used?: string | null
        }
        Update: {
          blocked_draft?: string | null
          clinic_id?: string
          compliance_blocked?: boolean
          compliance_rule?: string | null
          context_read?: Json | null
          conversation_id?: string
          created_at?: string
          escalation_reason?: string | null
          id?: string
          latency_ms?: number | null
          message_id?: string | null
          tool_used?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_decision_log_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_decision_log_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_decision_log_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "message"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment: {
        Row: {
          approval_status: string | null
          clinic_id: string
          confirmation_channel: string | null
          confirmed_by_user_id: string | null
          contact_id: string
          created_at: string
          created_by: string
          ends_at: string
          external_id: string | null
          id: string
          is_overbooking: boolean
          notes: string | null
          package_balance_id: string | null
          professional_id: string
          resource_id: string | null
          send_confirmation: boolean
          service_link_id: string
          source: string
          starts_at: string
          status: string
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          approval_status?: string | null
          clinic_id: string
          confirmation_channel?: string | null
          confirmed_by_user_id?: string | null
          contact_id: string
          created_at?: string
          created_by?: string
          ends_at: string
          external_id?: string | null
          id?: string
          is_overbooking?: boolean
          notes?: string | null
          package_balance_id?: string | null
          professional_id: string
          resource_id?: string | null
          send_confirmation?: boolean
          service_link_id: string
          source?: string
          starts_at: string
          status?: string
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          approval_status?: string | null
          clinic_id?: string
          confirmation_channel?: string | null
          confirmed_by_user_id?: string | null
          contact_id?: string
          created_at?: string
          created_by?: string
          ends_at?: string
          external_id?: string | null
          id?: string
          is_overbooking?: boolean
          notes?: string | null
          package_balance_id?: string | null
          professional_id?: string
          resource_id?: string | null
          send_confirmation?: boolean
          service_link_id?: string
          source?: string
          starts_at?: string
          status?: string
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_package_balance_id_fkey"
            columns: ["package_balance_id"]
            isOneToOne: false
            referencedRelation: "package_balance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resource"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_service_link_id_fkey"
            columns: ["service_link_id"]
            isOneToOne: false
            referencedRelation: "service_link"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "unit"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_status_history: {
        Row: {
          appointment_id: string
          changed_at: string
          changed_by: string
          changed_by_user_id: string | null
          clinic_id: string
          id: string
          status: string
        }
        Insert: {
          appointment_id: string
          changed_at?: string
          changed_by?: string
          changed_by_user_id?: string | null
          clinic_id: string
          id?: string
          status: string
        }
        Update: {
          appointment_id?: string
          changed_at?: string
          changed_by?: string
          changed_by_user_id?: string | null
          clinic_id?: string
          id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_status_history_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_status_history_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          clinic_id: string | null
          created_at: string
          entity: string
          entity_id: string | null
          id: number
          ip: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          clinic_id?: string | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: number
          ip?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          clinic_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: number
          ip?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      cadence: {
        Row: {
          active: boolean
          clinic_id: string
          created_at: string
          for_no_show_history: boolean
          id: string
          kind: string
          name: string
          no_show_threshold: number
          procedure_id: string | null
          send_weekdays: number[] | null
          send_window_end: string | null
          send_window_start: string | null
          trigger_stage: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          clinic_id: string
          created_at?: string
          for_no_show_history?: boolean
          id?: string
          kind: string
          name: string
          no_show_threshold?: number
          procedure_id?: string | null
          send_weekdays?: number[] | null
          send_window_end?: string | null
          send_window_start?: string | null
          trigger_stage?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          clinic_id?: string
          created_at?: string
          for_no_show_history?: boolean
          id?: string
          kind?: string
          name?: string
          no_show_threshold?: number
          procedure_id?: string | null
          send_weekdays?: number[] | null
          send_window_end?: string | null
          send_window_start?: string | null
          trigger_stage?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cadence_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedure"
            referencedColumns: ["id"]
          },
        ]
      }
      cadence_run: {
        Row: {
          appointment_id: string | null
          cadence_step_id: string
          clinic_id: string
          contact_id: string
          created_at: string
          id: string
          message_id: string | null
          scheduled_for: string
          sent_at: string | null
          skipped_reason: string | null
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          cadence_step_id: string
          clinic_id: string
          contact_id: string
          created_at?: string
          id?: string
          message_id?: string | null
          scheduled_for: string
          sent_at?: string | null
          skipped_reason?: string | null
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          cadence_step_id?: string
          clinic_id?: string
          contact_id?: string
          created_at?: string
          id?: string
          message_id?: string | null
          scheduled_for?: string
          sent_at?: string | null
          skipped_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cadence_run_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_run_cadence_step_id_fkey"
            columns: ["cadence_step_id"]
            isOneToOne: false
            referencedRelation: "cadence_step"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_run_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_run_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_run_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "message"
            referencedColumns: ["id"]
          },
        ]
      }
      cadence_step: {
        Row: {
          cadence_id: string
          clinic_id: string
          created_at: string
          fixed_body: string | null
          id: string
          offset_minutes: number
          stop_conditions: string[]
          template_id: string | null
          updated_at: string
          use_ai: boolean
        }
        Insert: {
          cadence_id: string
          clinic_id: string
          created_at?: string
          fixed_body?: string | null
          id?: string
          offset_minutes: number
          stop_conditions?: string[]
          template_id?: string | null
          updated_at?: string
          use_ai?: boolean
        }
        Update: {
          cadence_id?: string
          clinic_id?: string
          created_at?: string
          fixed_body?: string | null
          id?: string
          offset_minutes?: number
          stop_conditions?: string[]
          template_id?: string | null
          updated_at?: string
          use_ai?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "cadence_step_cadence_id_fkey"
            columns: ["cadence_id"]
            isOneToOne: false
            referencedRelation: "cadence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_step_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cadence_step_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "message_template"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_link: {
        Row: {
          active: boolean
          campaign: string | null
          channel: string
          clinic_id: string
          created_at: string
          default_message: string | null
          id: string
          keywords: string[]
          medium: string | null
          name: string
          origin: string | null
          token: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          campaign?: string | null
          channel: string
          clinic_id: string
          created_at?: string
          default_message?: string | null
          id?: string
          keywords?: string[]
          medium?: string | null
          name: string
          origin?: string | null
          token?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          campaign?: string | null
          channel?: string
          clinic_id?: string
          created_at?: string
          default_message?: string | null
          id?: string
          keywords?: string[]
          medium?: string | null
          name?: string
          origin?: string | null
          token?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_link_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic: {
        Row: {
          allow_code_signup: boolean
          created_at: string
          e_de_teste: boolean
          id: string
          name: string
          slug: string
          spend_cap_action: string
          spend_cap_cents: number | null
          timezone: string
          updated_at: string
        }
        Insert: {
          allow_code_signup?: boolean
          created_at?: string
          e_de_teste?: boolean
          id?: string
          name: string
          slug: string
          spend_cap_action?: string
          spend_cap_cents?: number | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          allow_code_signup?: boolean
          created_at?: string
          e_de_teste?: boolean
          id?: string
          name?: string
          slug?: string
          spend_cap_action?: string
          spend_cap_cents?: number | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      clinic_access_code: {
        Row: {
          clinic_id: string
          code: string
          created_at: string
          updated_at: string
        }
        Insert: {
          clinic_id: string
          code: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          code?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_access_code_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_branding: {
        Row: {
          clinic_id: string
          created_at: string
          labels: Json
          logo_icon_dark: string | null
          logo_icon_light: string | null
          logo_wide_dark: string | null
          logo_wide_light: string | null
          primary_color: string
          product_name: string
          updated_at: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          labels?: Json
          logo_icon_dark?: string | null
          logo_icon_light?: string | null
          logo_wide_dark?: string | null
          logo_wide_light?: string | null
          primary_color?: string
          product_name?: string
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          labels?: Json
          logo_icon_dark?: string | null
          logo_icon_light?: string | null
          logo_wide_dark?: string | null
          logo_wide_light?: string | null
          primary_color?: string
          product_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_branding_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_member: {
        Row: {
          clinic_id: string
          created_at: string
          professional_id: string | null
          role: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          professional_id?: string | null
          role: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          professional_id?: string | null
          role?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_member_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_member_professional_fk"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional"
            referencedColumns: ["id"]
          },
        ]
      }
      contact: {
        Row: {
          birth_date: string | null
          clinic_id: string
          cpf: string | null
          created_at: string
          email: string | null
          first_contact_at: string
          funnel_stage: string
          funnel_stage_changed_at: string
          id: string
          inactive_since: string | null
          insurance_card: string | null
          insurance_id: string | null
          kind: string
          last_contact_at: string | null
          lost_reason: string | null
          lost_reason_note: string | null
          name: string | null
          no_show_count: number
          notes: string | null
          owner_user_id: string | null
          phone_e164: string
          ctwa_clid: string | null
          source_ad_id: string | null
          source_adset_id: string | null
          source_campaign_id: string | null
          source_campaign: string | null
          source_captured_at: string | null
          source_channel: string | null
          source_medium: string | null
          source_method: string | null
          source_origin: string | null
          tags: string[]
          updated_at: string
        }
        Insert: {
          birth_date?: string | null
          clinic_id: string
          cpf?: string | null
          created_at?: string
          email?: string | null
          first_contact_at?: string
          funnel_stage?: string
          funnel_stage_changed_at?: string
          id?: string
          inactive_since?: string | null
          insurance_card?: string | null
          insurance_id?: string | null
          kind?: string
          last_contact_at?: string | null
          lost_reason?: string | null
          lost_reason_note?: string | null
          name?: string | null
          no_show_count?: number
          notes?: string | null
          owner_user_id?: string | null
          phone_e164: string
          ctwa_clid?: string | null
          source_ad_id?: string | null
          source_adset_id?: string | null
          source_campaign_id?: string | null
          source_campaign?: string | null
          source_captured_at?: string | null
          source_channel?: string | null
          source_medium?: string | null
          source_method?: string | null
          source_origin?: string | null
          tags?: string[]
          updated_at?: string
        }
        Update: {
          birth_date?: string | null
          clinic_id?: string
          cpf?: string | null
          created_at?: string
          email?: string | null
          first_contact_at?: string
          funnel_stage?: string
          funnel_stage_changed_at?: string
          id?: string
          inactive_since?: string | null
          insurance_card?: string | null
          insurance_id?: string | null
          kind?: string
          last_contact_at?: string | null
          lost_reason?: string | null
          lost_reason_note?: string | null
          name?: string | null
          no_show_count?: number
          notes?: string | null
          owner_user_id?: string | null
          phone_e164?: string
          ctwa_clid?: string | null
          source_ad_id?: string | null
          source_adset_id?: string | null
          source_campaign_id?: string | null
          source_campaign?: string | null
          source_captured_at?: string | null
          source_channel?: string | null
          source_medium?: string | null
          source_method?: string | null
          source_origin?: string | null
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_insurance_fk"
            columns: ["insurance_id"]
            isOneToOne: false
            referencedRelation: "insurance"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_consent: {
        Row: {
          active: boolean | null
          channel: string
          clinic_id: string
          contact_id: string
          created_at: string
          evidence: string | null
          granted_at: string
          id: string
          revoked_at: string | null
          source: string
          updated_at: string
        }
        Insert: {
          active?: boolean | null
          channel?: string
          clinic_id: string
          contact_id: string
          created_at?: string
          evidence?: string | null
          granted_at?: string
          id?: string
          revoked_at?: string | null
          source: string
          updated_at?: string
        }
        Update: {
          active?: boolean | null
          channel?: string
          clinic_id?: string
          contact_id?: string
          created_at?: string
          evidence?: string | null
          granted_at?: string
          id?: string
          revoked_at?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_consent_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_consent_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
        ]
      }
      conversion_event: {
        Row: {
          clinic_id: string
          contact_id: string
          created_at: string
          ctwa_clid: string | null
          currency: string
          erro: string | null
          event_id: string
          event_name: string
          id: string
          sent_at: string | null
          stage_chave: string
          status: string
          updated_at: string
          value_cents: number | null
        }
        Insert: {
          clinic_id: string
          contact_id: string
          created_at?: string
          ctwa_clid?: string | null
          currency?: string
          erro?: string | null
          event_id?: string
          event_name: string
          id?: string
          sent_at?: string | null
          stage_chave: string
          status?: string
          updated_at?: string
          value_cents?: number | null
        }
        Update: {
          clinic_id?: string
          contact_id?: string
          created_at?: string
          ctwa_clid?: string | null
          currency?: string
          erro?: string | null
          event_id?: string
          event_name?: string
          id?: string
          sent_at?: string | null
          stage_chave?: string
          status?: string
          updated_at?: string
          value_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "conversion_event_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_event_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation: {
        Row: {
          assignee_user_id: string | null
          awaiting_reply: boolean
          clinic_id: string
          contact_id: string
          created_at: string
          id: string
          last_inbound_at: string | null
          last_message_at: string | null
          status: string
          tags: string[]
          unread_count: number
          updated_at: string
          window_expires_at: string | null
        }
        Insert: {
          assignee_user_id?: string | null
          awaiting_reply?: boolean
          clinic_id: string
          contact_id: string
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          status?: string
          tags?: string[]
          unread_count?: number
          updated_at?: string
          window_expires_at?: string | null
        }
        Update: {
          assignee_user_id?: string | null
          awaiting_reply?: boolean
          clinic_id?: string
          contact_id?: string
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          status?: string
          tags?: string[]
          unread_count?: number
          updated_at?: string
          window_expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_stage_def: {
        Row: {
          chave: string
          clinic_id: string
          conversao_ativa: boolean
          created_at: string
          icone: string
          id: string
          is_first_contact: boolean
          is_sale: boolean
          meta_event_name: string | null
          nome: string
          papel: string | null
          posicao: number
          termos_chave: string[]
          tom: string
          updated_at: string
          value_cents: number | null
          value_source: string | null
        }
        Insert: {
          chave: string
          clinic_id: string
          conversao_ativa?: boolean
          created_at?: string
          icone?: string
          id?: string
          is_first_contact?: boolean
          is_sale?: boolean
          meta_event_name?: string | null
          nome: string
          papel?: string | null
          posicao: number
          termos_chave?: string[]
          tom?: string
          updated_at?: string
          value_cents?: number | null
          value_source?: string | null
        }
        Update: {
          chave?: string
          clinic_id?: string
          conversao_ativa?: boolean
          created_at?: string
          icone?: string
          id?: string
          is_first_contact?: boolean
          is_sale?: boolean
          meta_event_name?: string | null
          nome?: string
          papel?: string | null
          posicao?: number
          termos_chave?: string[]
          tom?: string
          updated_at?: string
          value_cents?: number | null
          value_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "funnel_stage_def_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      health_check: {
        Row: {
          created_at: string
          id: string
          label: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
        }
        Relationships: []
      }
      insurance: {
        Row: {
          active: boolean
          clinic_id: string
          created_at: string
          id: string
          name: string
          notes: string | null
          plan_name: string | null
          requires_card: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          clinic_id: string
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          plan_name?: string | null
          requires_card?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          clinic_id?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          plan_name?: string | null
          requires_card?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "insurance_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      job_queue: {
        Row: {
          attempts: number
          clinic_id: string
          created_at: string
          devolucoes: number
          id: string
          kind: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          run_at: string
          status: string
          ultimo_motivo_devolucao: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          clinic_id: string
          created_at?: string
          devolucoes?: number
          id?: string
          kind: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          run_at?: string
          status?: string
          ultimo_motivo_devolucao?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          clinic_id?: string
          created_at?: string
          devolucoes?: number
          id?: string
          kind?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          run_at?: string
          status?: string
          ultimo_motivo_devolucao?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_queue_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      message: {
        Row: {
          author: string
          author_user_id: string | null
          billable: boolean
          body: string | null
          clinic_id: string
          content_type: string
          conversation_id: string
          cost_cents: number | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_escopo: string | null
          deleted_source: string | null
          delivery_status: string | null
          direction: string
          error_code: string | null
          id: string
          is_internal_note: boolean
          job_id: string | null
          media_url: string | null
          pricing_category: string | null
          reply_to_message_id: string | null
          reply_to_wa_message_id: string | null
          template_id: string | null
          transcript: string | null
          updated_at: string
          wa_message_id: string | null
        }
        Insert: {
          author: string
          author_user_id?: string | null
          billable?: boolean
          body?: string | null
          clinic_id: string
          content_type?: string
          conversation_id: string
          cost_cents?: number | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_escopo?: string | null
          deleted_source?: string | null
          delivery_status?: string | null
          direction: string
          error_code?: string | null
          id?: string
          is_internal_note?: boolean
          job_id?: string | null
          media_url?: string | null
          pricing_category?: string | null
          reply_to_message_id?: string | null
          reply_to_wa_message_id?: string | null
          template_id?: string | null
          transcript?: string | null
          updated_at?: string
          wa_message_id?: string | null
        }
        Update: {
          author?: string
          author_user_id?: string | null
          billable?: boolean
          body?: string | null
          clinic_id?: string
          content_type?: string
          conversation_id?: string
          cost_cents?: number | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_escopo?: string | null
          deleted_source?: string | null
          delivery_status?: string | null
          direction?: string
          error_code?: string | null
          id?: string
          is_internal_note?: boolean
          job_id?: string | null
          media_url?: string | null
          pricing_category?: string | null
          reply_to_message_id?: string | null
          reply_to_wa_message_id?: string | null
          template_id?: string | null
          transcript?: string | null
          updated_at?: string
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "job_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "message"
            referencedColumns: ["id"]
          },
        ]
      }
      message_apagada: {
        Row: {
          apagada_em: string
          apagada_por: string | null
          body: string | null
          clinic_id: string
          content_type: string | null
          conversation_id: string
          escopo: string
          media_url: string | null
          message_id: string
          origem: string
          transcript: string | null
          wa_message_id: string | null
        }
        Insert: {
          apagada_em?: string
          apagada_por?: string | null
          body?: string | null
          clinic_id: string
          content_type?: string | null
          conversation_id: string
          escopo: string
          media_url?: string | null
          message_id: string
          origem: string
          transcript?: string | null
          wa_message_id?: string | null
        }
        Update: {
          apagada_em?: string
          apagada_por?: string | null
          body?: string | null
          clinic_id?: string
          content_type?: string | null
          conversation_id?: string
          escopo?: string
          media_url?: string | null
          message_id?: string
          origem?: string
          transcript?: string | null
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_apagada_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_apagada_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "message"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_ads_account: {
        Row: {
          ad_account_id: string | null
          clinic_id: string
          created_at: string
          envio_ativado: boolean
          modo_user_data: string | null
          pixel_id: string | null
          send_unmatched: boolean
          test_event_code: string | null
          updated_at: string
          whatsapp_business_account_id: string | null
        }
        Insert: {
          ad_account_id?: string | null
          clinic_id: string
          created_at?: string
          envio_ativado?: boolean
          modo_user_data?: string | null
          pixel_id?: string | null
          send_unmatched?: boolean
          test_event_code?: string | null
          updated_at?: string
          whatsapp_business_account_id?: string | null
        }
        Update: {
          ad_account_id?: string | null
          clinic_id?: string
          created_at?: string
          envio_ativado?: boolean
          modo_user_data?: string | null
          pixel_id?: string | null
          send_unmatched?: boolean
          test_event_code?: string | null
          updated_at?: string
          whatsapp_business_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_ads_account_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_ads_account_secret: {
        Row: {
          capi_access_token: string | null
          clinic_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          capi_access_token?: string | null
          clinic_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          capi_access_token?: string | null
          clinic_id?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_ads_account_secret_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      message_pricing: {
        Row: {
          category: string
          cents: number
          created_at: string
          currency: string
          id: string
          valid_from: string
        }
        Insert: {
          category: string
          cents: number
          created_at?: string
          currency?: string
          id?: string
          valid_from: string
        }
        Update: {
          category?: string
          cents?: number
          created_at?: string
          currency?: string
          id?: string
          valid_from?: string
        }
        Relationships: []
      }
      message_template: {
        Row: {
          body: string
          buttons: Json | null
          category: string
          clinic_id: string
          created_at: string
          id: string
          language: string
          meta_status: string
          meta_template_id: string | null
          name: string
          updated_at: string
        }
        Insert: {
          body: string
          buttons?: Json | null
          category: string
          clinic_id: string
          created_at?: string
          id?: string
          language?: string
          meta_status?: string
          meta_template_id?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          body?: string
          buttons?: Json | null
          category?: string
          clinic_id?: string
          created_at?: string
          id?: string
          language?: string
          meta_status?: string
          meta_template_id?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_template_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      package: {
        Row: {
          clinic_id: string
          created_at: string
          id: string
          price_cents: number
          procedure_id: string
          sessions: number
          updated_at: string
          validity_days: number | null
        }
        Insert: {
          clinic_id: string
          created_at?: string
          id?: string
          price_cents: number
          procedure_id: string
          sessions: number
          updated_at?: string
          validity_days?: number | null
        }
        Update: {
          clinic_id?: string
          created_at?: string
          id?: string
          price_cents?: number
          procedure_id?: string
          sessions?: number
          updated_at?: string
          validity_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "package_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedure"
            referencedColumns: ["id"]
          },
        ]
      }
      package_balance: {
        Row: {
          clinic_id: string
          contact_id: string
          created_at: string
          expires_at: string | null
          id: string
          package_id: string
          sessions_total: number
          sessions_used: number
          updated_at: string
        }
        Insert: {
          clinic_id: string
          contact_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          package_id: string
          sessions_total: number
          sessions_used?: number
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          contact_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          package_id?: string
          sessions_total?: number
          sessions_used?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_balance_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_balance_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_balance_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "package"
            referencedColumns: ["id"]
          },
        ]
      }
      procedure: {
        Row: {
          active: boolean
          base_price_cents: number | null
          bookable_by_ai: boolean
          clinic_id: string
          created_at: string
          default_duration_min: number
          description: string | null
          id: string
          name: string
          prep_instructions: string | null
          requires_evaluation: boolean
          resource_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          base_price_cents?: number | null
          bookable_by_ai?: boolean
          clinic_id: string
          created_at?: string
          default_duration_min?: number
          description?: string | null
          id?: string
          name: string
          prep_instructions?: string | null
          requires_evaluation?: boolean
          resource_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          base_price_cents?: number | null
          bookable_by_ai?: boolean
          clinic_id?: string
          created_at?: string
          default_duration_min?: number
          description?: string | null
          id?: string
          name?: string
          prep_instructions?: string | null
          requires_evaluation?: boolean
          resource_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "procedure_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedure_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resource"
            referencedColumns: ["id"]
          },
        ]
      }
      product_admin: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      professional: {
        Row: {
          active: boolean
          calendar_color: string | null
          clinic_id: string
          council_number: string | null
          council_type: string | null
          created_at: string
          id: string
          name: string
          photo_url: string | null
          specialties: string[]
          updated_at: string
        }
        Insert: {
          active?: boolean
          calendar_color?: string | null
          clinic_id: string
          council_number?: string | null
          council_type?: string | null
          created_at?: string
          id?: string
          name: string
          photo_url?: string | null
          specialties?: string[]
          updated_at?: string
        }
        Update: {
          active?: boolean
          calendar_color?: string | null
          clinic_id?: string
          council_number?: string | null
          council_type?: string | null
          created_at?: string
          id?: string
          name?: string
          photo_url?: string | null
          specialties?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_block: {
        Row: {
          blocks_overbooking: boolean
          clinic_id: string
          created_at: string
          ends_at: string
          id: string
          professional_id: string
          reason: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          blocks_overbooking?: boolean
          clinic_id: string
          created_at?: string
          ends_at: string
          id?: string
          professional_id: string
          reason: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          blocks_overbooking?: boolean
          clinic_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          professional_id?: string
          reason?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_block_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_block_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_schedule: {
        Row: {
          clinic_id: string
          created_at: string
          ends_at: string
          id: string
          professional_id: string
          starts_at: string
          unit_id: string | null
          updated_at: string
          weekday: number
        }
        Insert: {
          clinic_id: string
          created_at?: string
          ends_at: string
          id?: string
          professional_id: string
          starts_at: string
          unit_id?: string | null
          updated_at?: string
          weekday: number
        }
        Update: {
          clinic_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          professional_id?: string
          starts_at?: string
          unit_id?: string | null
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "professional_schedule_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_schedule_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_schedule_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "unit"
            referencedColumns: ["id"]
          },
        ]
      }
      profile: {
        Row: {
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      resource: {
        Row: {
          active: boolean
          clinic_id: string
          created_at: string
          id: string
          kind: string
          name: string
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          clinic_id: string
          created_at?: string
          id?: string
          kind: string
          name: string
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          clinic_id?: string
          created_at?: string
          id?: string
          kind?: string
          name?: string
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "unit"
            referencedColumns: ["id"]
          },
        ]
      }
      service_link: {
        Row: {
          active: boolean
          bookable_by_ai: boolean
          clinic_id: string
          covered_by_insurance: boolean
          created_at: string
          duration_min: number
          id: string
          insurance_id: string | null
          price_cents: number | null
          procedure_id: string
          professional_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          bookable_by_ai?: boolean
          clinic_id: string
          covered_by_insurance?: boolean
          created_at?: string
          duration_min: number
          id?: string
          insurance_id?: string | null
          price_cents?: number | null
          procedure_id: string
          professional_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          bookable_by_ai?: boolean
          clinic_id?: string
          covered_by_insurance?: boolean
          created_at?: string
          duration_min?: number
          id?: string
          insurance_id?: string | null
          price_cents?: number | null
          procedure_id?: string
          professional_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_link_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_link_insurance_id_fkey"
            columns: ["insurance_id"]
            isOneToOne: false
            referencedRelation: "insurance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_link_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedure"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_link_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional"
            referencedColumns: ["id"]
          },
        ]
      }
      slot_hold: {
        Row: {
          clinic_id: string
          contact_id: string | null
          created_at: string
          created_by: string
          ends_at: string
          expires_at: string
          id: string
          professional_id: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          clinic_id: string
          contact_id?: string | null
          created_at?: string
          created_by?: string
          ends_at: string
          expires_at: string
          id?: string
          professional_id: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          contact_id?: string | null
          created_at?: string
          created_by?: string
          ends_at?: string
          expires_at?: string
          id?: string
          professional_id?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "slot_hold_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_hold_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_hold_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional"
            referencedColumns: ["id"]
          },
        ]
      }
      unit: {
        Row: {
          active: boolean
          address: string | null
          clinic_id: string
          created_at: string
          id: string
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          clinic_id: string
          created_at?: string
          id?: string
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          clinic_id?: string
          created_at?: string
          id?: string
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_account: {
        Row: {
          business_verified: boolean
          clinic_id: string
          connected_at: string | null
          connection_status: string
          created_at: string
          disconnected_at: string | null
          display_phone: string | null
          instance_id: string | null
          messaging_limit: string | null
          next_send_at: string | null
          phone_number_id: string | null
          provider: string
          quality_rating: string | null
          server_url: string | null
          updated_at: string
          waba_id: string | null
        }
        Insert: {
          business_verified?: boolean
          clinic_id: string
          connected_at?: string | null
          connection_status?: string
          created_at?: string
          disconnected_at?: string | null
          display_phone?: string | null
          instance_id?: string | null
          messaging_limit?: string | null
          next_send_at?: string | null
          phone_number_id?: string | null
          provider?: string
          quality_rating?: string | null
          server_url?: string | null
          updated_at?: string
          waba_id?: string | null
        }
        Update: {
          business_verified?: boolean
          clinic_id?: string
          connected_at?: string | null
          connection_status?: string
          created_at?: string
          disconnected_at?: string | null
          display_phone?: string | null
          instance_id?: string | null
          messaging_limit?: string | null
          next_send_at?: string | null
          phone_number_id?: string | null
          provider?: string
          quality_rating?: string | null
          server_url?: string | null
          updated_at?: string
          waba_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_account_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_account_secret: {
        Row: {
          clinic_id: string
          created_at: string
          instance_token: string | null
          qr_code: string | null
          qr_code_expires_at: string | null
          updated_at: string
          webhook_secret: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          instance_token?: string | null
          qr_code?: string | null
          qr_code_expires_at?: string | null
          updated_at?: string
          webhook_secret?: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          instance_token?: string | null
          qr_code?: string | null
          qr_code_expires_at?: string | null
          updated_at?: string
          webhook_secret?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_account_secret_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinic"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_heartbeat: {
        Row: {
          batida_em: string
          criado_em: string
          ultimo_erro: string | null
          ultimo_erro_em: string | null
          ultimo_lote: number
          worker_id: string
        }
        Insert: {
          batida_em?: string
          criado_em?: string
          ultimo_erro?: string | null
          ultimo_erro_em?: string | null
          ultimo_lote?: number
          worker_id: string
        }
        Update: {
          batida_em?: string
          criado_em?: string
          ultimo_erro?: string | null
          ultimo_erro_em?: string | null
          ultimo_lote?: number
          worker_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apagar_mensagem: {
        Args: { p_escopo: string; p_message_id: string }
        Returns: Json
      }
      arquivar_e_limpar_mensagem: {
        Args: {
          p_escopo: string
          p_message_id: string
          p_origem: string
          p_por: string
        }
        Returns: undefined
      }
      bater_ponto_do_worker: {
        Args: { p_ultimo_lote?: number; p_worker_id: string }
        Returns: undefined
      }
      cancelar_pelo_paciente: {
        Args: {
          p_appointment_id: string
          p_clinic_id: string
          p_contact_id: string
          p_conversation_id?: string
        }
        Returns: Json
      }
      claim_jobs: {
        Args: { p_limit?: number; p_worker: string }
        Returns: {
          attempts: number
          clinic_id: string
          created_at: string
          devolucoes: number
          id: string
          kind: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          run_at: string
          status: string
          ultimo_motivo_devolucao: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "job_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_jobs_por_clinica: {
        Args: {
          p_incluir_teste?: boolean
          p_kinds: string[]
          p_max_clinicas: number
          p_worker: string
        }
        Returns: {
          attempts: number
          clinic_id: string
          created_at: string
          devolucoes: number
          id: string
          kind: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          run_at: string
          status: string
          ultimo_motivo_devolucao: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "job_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      concluir_job: {
        Args: { p_id: string; p_worker: string }
        Returns: undefined
      }
      confirmar_pelo_paciente: {
        Args: {
          p_appointment_id: string
          p_clinic_id: string
          p_contact_id: string
          p_conversation_id?: string
        }
        Returns: Json
      }
      confirmar_posse_job: {
        Args: { p_id: string; p_worker: string }
        Returns: boolean
      }
      consentimento_vigente: {
        Args: { p_channel?: string; p_clinic_id: string; p_contact_id: string }
        Returns: boolean
      }
      conversoes_devolvidas_da_clinica: {
        Args: { p_clinic_id: string }
        Returns: Json
      }
      disparar_ciclo_do_motor: { Args: never; Returns: undefined }
      emails_da_equipe: {
        Args: { p_clinic_id: string }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      etiquetar_contatos: {
        Args: {
          p_adicionar: string[]
          p_clinic_id: string
          p_contact_ids: string[]
          p_remover: string[]
        }
        Returns: number
      }
      falhar_job: {
        Args: {
          p_definitivo: boolean
          p_erro: string
          p_id: string
          p_worker: string
        }
        Returns: undefined
      }
      fechar_runs_orfas: { Args: never; Returns: number }
      garantir_conversa_aberta: {
        Args: { p_clinic_id: string; p_contact_id: string }
        Returns: string
      }
      incrementar_no_show: {
        Args: { p_contact_id: string }
        Returns: undefined
      }
      ingest_inbound_message: {
        Args: {
          p_body?: string
          p_clinic_id: string
          p_content_type?: string
          p_media_url?: string
          p_name: string
          p_phone_e164: string
          p_transcript?: string
          p_wa_message_id: string
        }
        Returns: Json
      }
      is_product_admin: { Args: never; Returns: boolean }
      limpar_holds_vencidos: { Args: never; Returns: number }
      marcar_aguardando_confirmacao: {
        Args: { p_appointment_id: string; p_clinic_id: string }
        Returns: Json
      }
      midia_mensagem_do_caminho: {
        Args: { p_caminho: string }
        Returns: string
      }
      minhas_clinicas_pendentes: {
        Args: never
        Returns: {
          clinic_id: string
          clinic_name: string
        }[]
      }
      motor_agendar: { Args: never; Returns: string }
      motor_desagendar: { Args: never; Returns: string }
      motor_manutencao: { Args: never; Returns: Json }
      pacientes_resumo: {
        Args: { p_clinic_id: string }
        Returns: {
          contact_id: string
          insurance_id: string
          insurance_name: string
          name: string
          no_show_count: number
          phone_e164: string
          profissionais_ids: string[]
          proxima_consulta: string
          saldo_sessoes: number
          saldo_total: number
          tags: string[]
          total_compareceu: number
          total_faltou: number
          ultima_consulta: string
        }[]
      }
      planejar_reguas: { Args: never; Returns: Json }
      reordenar_etapa_da_jornada: {
        Args: { p_chave: string; p_clinic_id: string; p_direcao: string }
        Returns: string
      }
      pode_apagar_mensagem: {
        Args: { p_escopo: string; p_message_id: string }
        Returns: Json
      }
      reagendar_job: {
        Args: {
          p_id: string
          p_motivo?: string
          p_run_at: string
          p_worker: string
        }
        Returns: boolean
      }
      registrar_apagamento_do_whatsapp: {
        Args: { p_clinic_id: string; p_wa_message_id: string }
        Returns: Json
      }
      reservar_slot_envio: {
        Args: { p_clinic_id: string; p_espaco_ms: number }
        Returns: number
      }
      reservar_slot_envio_v2: {
        Args: {
          p_clinic_id: string
          p_espaco_ms: number
          p_espera_maxima_ms: number
        }
        Returns: Json
      }
      saude_do_motor: { Args: never; Returns: Json }
      seed_reguas_padrao: { Args: { p_clinic_id: string }; Returns: undefined }
      substituir_jornada: {
        Args: { p_clinic_id: string; p_faixas: Json; p_professional_id: string }
        Returns: undefined
      }
      user_active_clinic_ids: { Args: never; Returns: string[] }
      user_can_write: { Args: { p_clinic_id: string }; Returns: boolean }
      user_clinic_ids: { Args: never; Returns: string[] }
      user_has_role: {
        Args: { p_clinic_id: string; p_roles: string[] }
        Returns: boolean
      }
      user_professional_id: { Args: { p_clinic_id: string }; Returns: string }
      validar_codigo_clinica: { Args: { p_codigo: string }; Returns: Json }
      vincular_citacao_recebida: {
        Args: {
          p_clinic_id: string
          p_message_id: string
          p_quoted_wa_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

