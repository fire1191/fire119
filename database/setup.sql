-- Supabase SQL Editor에서 실행. 신청 명단은 공개하지 않습니다.
create table public.training_admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.training_admins enable row level security;
revoke all on public.training_admins from anon, authenticated;

create function public.is_training_admin() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.training_admins where user_id = auth.uid());
$$;
revoke all on function public.is_training_admin() from public, anon, authenticated;
grant execute on function public.is_training_admin() to authenticated;

create table public.trainings (
 id uuid primary key default gen_random_uuid(), title text not null check(char_length(title) between 1 and 150),
 event_date date not null, sessions text[] not null check(cardinality(sessions) between 1 and 10),
 privacy_notice text not null check(char_length(privacy_notice) between 20 and 3000),
 is_open boolean not null default false, created_at timestamptz not null default now()
);
create unique index one_open_training on public.trainings ((true)) where is_open;
alter table public.trainings enable row level security;
revoke all on public.trainings from anon, authenticated;
grant select,insert,update on public.trainings to authenticated;
create policy admin_trainings on public.trainings for all to authenticated using (public.is_training_admin()) with check (public.is_training_admin());

create table public.registrations (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references public.trainings(id),
 request_id uuid not null unique, employee_id text not null, name text not null, department text not null,
 email text not null, session text not null, consent boolean not null check(consent),
 consent_notice text not null, created_at timestamptz not null default now(),
 unique(event_id, employee_id)
);
alter table public.registrations enable row level security;
revoke all on public.registrations from anon, authenticated;
grant select,delete on public.registrations to authenticated;
create policy admin_read on public.registrations for select to authenticated using(public.is_training_admin());
create policy admin_delete on public.registrations for delete to authenticated using(public.is_training_admin());

create function public.current_training() returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('id',id,'title',title,'event_date',event_date,'sessions',sessions,'privacy_notice',privacy_notice)
 from public.trainings where is_open limit 1;
$$;
revoke all on function public.current_training() from public,anon,authenticated;
grant execute on function public.current_training() to anon,authenticated;

create function public.register_training(p_event_id uuid,p_employee_id text,p_name text,p_department text,p_email text,p_session text,p_consent boolean,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.trainings; r public.registrations;
begin
 if p_request_id is null or p_employee_id is null or p_name is null or p_department is null or p_email is null or p_session is null or p_consent is distinct from true then raise exception '필수 항목과 동의 여부를 확인해 주세요.'; end if;
 p_employee_id := btrim(p_employee_id); p_name := btrim(p_name); p_department := btrim(p_department); p_email := btrim(p_email);
 if char_length(p_employee_id) not between 1 and 30 or char_length(p_name) not between 1 and 50 or char_length(p_department) not between 1 and 100 or char_length(p_email) > 254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception '입력한 정보의 길이와 이메일 형식을 확인해 주세요.'; end if;
 -- 재시도는 최초 요청과 모든 내용이 일치할 때만 접수 결과를 반환.
 select * into r from public.registrations where request_id=p_request_id;
 if found then
   if r.event_id=p_event_id and r.employee_id=p_employee_id and r.name=p_name and r.department=p_department and r.email=p_email and r.session=p_session then return jsonb_build_object('created_at',r.created_at); end if;
   raise exception '전송한 내용이 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
 end if;
 select * into t from public.trainings where id=p_event_id and is_open for share;
 if not found then raise exception '접수가 종료되었거나 교육이 변경되었습니다. 새로고침해 주세요.'; end if;
 if not (p_session=any(t.sessions)) then raise exception '신청 가능한 교육 시간을 선택해 주세요.'; end if;
 begin
 insert into public.registrations(event_id,request_id,employee_id,name,department,email,session,consent,consent_notice)
 values(p_event_id,p_request_id,p_employee_id,p_name,p_department,p_email,p_session,true,t.privacy_notice) returning * into r;
 exception when unique_violation then
   select * into r from public.registrations where request_id=p_request_id;
   if found and r.event_id=p_event_id and r.employee_id=p_employee_id and r.name=p_name and r.department=p_department and r.email=p_email and r.session=p_session then return jsonb_build_object('created_at',r.created_at); end if;
   raise exception '접수 상태를 확인해 주세요. 이미 신청한 경우 담당자에게 문의해 주세요.';
 end;
 return jsonb_build_object('created_at',r.created_at);
end;
$$;
revoke all on function public.register_training(uuid,text,text,text,text,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.register_training(uuid,text,text,text,text,text,boolean,uuid) to anon,authenticated;

-- 초안: 실제 관리자가 개인정보 안내를 확정하고 접수를 열기 전에는 공개되지 않습니다.
insert into public.trainings(title,event_date,sessions,privacy_notice,is_open) values (
 '2026학년도 하반기 교직원 소방안전교육','2026-11-24',array['[1차] 10:00~11:00','[2차] 14:00~15:00'],
 '[게시 전 수정 필요] 수집 주체·문의처: 담당 부서에서 작성\n수집 항목: 이름, 사번, 소속, 이메일, 참여 시간, 신청 일시\n수집 목적: 소방안전교육 신청 및 참여 명단 관리\n보유 기간: 담당 부서에서 확정하여 작성\n동의를 거부할 수 있으며, 미동의 시 온라인 신청이 어렵습니다.',false
);
