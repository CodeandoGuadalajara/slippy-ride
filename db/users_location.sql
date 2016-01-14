--
-- PostgreSQL database dump
--

-- Dumped from database version 9.4.4
-- Dumped by pg_dump version 9.4.4
-- Started on 2015-10-28 21:04:17 CST

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET client_min_messages = warning;

--
-- TOC entry 7 (class 2615 OID 17682)
-- Name: sleipnir; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA sleipnir;


SET search_path = sleipnir, pg_catalog;

SET default_tablespace = '';

SET default_with_oids = false;

--
-- TOC entry 187 (class 1259 OID 17689)
-- Name: users_location; Type: TABLE; Schema: sleipnir; Owner: -; Tablespace: 
--

CREATE TABLE users_location (
    gid integer NOT NULL,
    name text NOT NULL,
    status numeric,
    geography public.geography(Point,4326),
    id_connection text,
    search_radius numeric
);


--
-- TOC entry 186 (class 1259 OID 17687)
-- Name: users_location_gid_seq; Type: SEQUENCE; Schema: sleipnir; Owner: -
--

CREATE SEQUENCE users_location_gid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3230 (class 0 OID 0)
-- Dependencies: 186
-- Name: users_location_gid_seq; Type: SEQUENCE OWNED BY; Schema: sleipnir; Owner: -
--

ALTER SEQUENCE users_location_gid_seq OWNED BY users_location.gid;


--
-- TOC entry 3104 (class 2604 OID 17692)
-- Name: gid; Type: DEFAULT; Schema: sleipnir; Owner: -
--

ALTER TABLE ONLY users_location ALTER COLUMN gid SET DEFAULT nextval('users_location_gid_seq'::regclass);


--
-- TOC entry 3225 (class 0 OID 17689)
-- Dependencies: 187
-- Data for Name: users_location; Type: TABLE DATA; Schema: sleipnir; Owner: -
--

COPY users_location (gid, name, status, geography, id_connection, search_radius) FROM stdin;
\.


--
-- TOC entry 3231 (class 0 OID 0)
-- Dependencies: 186
-- Name: users_location_gid_seq; Type: SEQUENCE SET; Schema: sleipnir; Owner: -
--

SELECT pg_catalog.setval('users_location_gid_seq', 114, true);


--
-- TOC entry 3107 (class 2606 OID 17697)
-- Name: pk_gid; Type: CONSTRAINT; Schema: sleipnir; Owner: -; Tablespace: 
--

ALTER TABLE ONLY users_location
    ADD CONSTRAINT pk_gid PRIMARY KEY (gid);


--
-- TOC entry 3105 (class 1259 OID 17698)
-- Name: geography_gix; Type: INDEX; Schema: sleipnir; Owner: -; Tablespace: 
--

CREATE INDEX geography_gix ON users_location USING gist (geography);


-- Completed on 2015-10-28 21:04:18 CST

--
-- PostgreSQL database dump complete
--

