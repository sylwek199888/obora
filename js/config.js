/**
 * config.js — USTAWIENIA SUPABASE (opcjonalne)
 * Jeśli wpiszesz tu adres i klucz swojego projektu Supabase, pracownicy nie będą
 * musieli ich wklejać — wystarczy, że się zalogują. Można też zostawić puste
 * i wpisać dane w aplikacji: Więcej → Synchronizacja.
 *
 * Klucz „anon public” jest jawny z założenia (zabezpieczeniem są reguły RLS
 * z pliku supabase/schema.sql). NIGDY nie wpisuj tu klucza „service_role”.
 */
export const SUPABASE_URL = '';       // np. 'https://abcdefghijklm.supabase.co'
export const SUPABASE_ANON_KEY = '';  // długi tekst zaczynający się od 'eyJ...' lub 'sb_publishable_...'
